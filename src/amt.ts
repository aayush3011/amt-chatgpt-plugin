// amt.ts - thin client for the AMT REST surface over the Inference Platform gateway.
//
// The ChatGPT Apps SDK server does not own identity. Every ChatGPT request that reaches this
// server carries the user's connector Authorization header (minted by the gateway's OAuth
// discovery when the user added the connector and signed in with Microsoft). We stash that
// header per-request in AsyncLocalStorage and forward it verbatim to the gateway, so the
// gateway resolves x-amt-context from the real caller. For local dev / notebooks, an
// AMT_ACCESS_TOKEN env var is honored as an escape hatch.

import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestState {
  authHeader?: string;
}

export const requestContext = new AsyncLocalStorage<RequestState>();

const GATEWAY_BASE =
  process.env.AMT_GATEWAY_BASE ??
  "https://reranker-api-h2b5czhkfkcphnf4.westus3-01.azurewebsites.net/inference/memory";

function resolveAuthHeader(): string | undefined {
  const fromRequest = requestContext.getStore()?.authHeader;
  if (fromRequest) return fromRequest;

  const token = process.env.AMT_ACCESS_TOKEN?.trim();
  if (!token) return undefined;
  if (/^(Bearer|HookToken)\s/i.test(token)) return token;
  return `Bearer ${token}`;
}

interface AmtRequest {
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
}

export async function amt<T = Record<string, unknown>>(
  path: string,
  { method = "GET", body, timeoutMs = 15000 }: AmtRequest = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {};
    const auth = resolveAuthHeader();
    if (auth) headers.Authorization = auth;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(`${GATEWAY_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "AMT gateway rejected the request (not signed in). Reconnect the AMT connector and complete the Microsoft sign-in.",
      );
    }
    if (!res.ok) throw new Error(`AMT ${method} ${path} -> HTTP ${res.status}`);

    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface MemoryItem {
  id?: string;
  scope_key?: string;
  memory_type?: string;
  type?: string;
  content?: string;
  text?: string;
  similarity_score?: number;
}

export interface WhoAmI {
  principal?: string;
  tenant_id?: string;
  agent_id?: string;
  groups?: string[];
  roles?: string[];
}

export type Tier = "personal" | "team" | "org" | "other";

export function tierOf(scopeKey = ""): Tier {
  if (scopeKey.startsWith("user:")) return "personal";
  if (scopeKey.startsWith("team:")) return "team";
  if (scopeKey.startsWith("org:")) return "org";
  return "other";
}

export interface PanelMemory {
  id: string;
  scope_key: string;
  type: string;
  content: string;
}

export interface MemoryPanel {
  principal: string;
  tenant: string;
  groups: {
    personal: PanelMemory[];
    team: PanelMemory[];
    org: PanelMemory[];
  };
}

function shape(item: MemoryItem): PanelMemory {
  return {
    id: item.id ?? "",
    scope_key: item.scope_key ?? "",
    type: item.memory_type ?? item.type ?? "fact",
    content: item.content ?? item.text ?? "",
  };
}

// Build the three-tier (personal / team / org) view the widget renders. Personal comes from
// the recent-memories list; team/org come from a scoped search (the shared-read surface).
export async function loadMemoryPanel(): Promise<MemoryPanel> {
  const who = await amt<WhoAmI>("/whoami").catch(() => ({}) as WhoAmI);
  const orgScope = who.tenant_id ? `org:${who.tenant_id}` : null;
  const teamScopes = (who.groups ?? []).map((g) => (g.startsWith("team:") ? g : `team:${g}`));
  const sharedScopes = [...teamScopes, ...(orgScope ? [orgScope] : [])];

  const personal = await amt<{ items?: MemoryItem[] }>("/memories?recent_k=30").catch(() => ({
    items: [],
  }));
  const shared = sharedScopes.length
    ? await amt<{ items?: MemoryItem[] }>("/search", {
        method: "POST",
        body: {
          query: "team and organization knowledge, standards, and decisions",
          top_k: 25,
          scopes: sharedScopes,
        },
      }).catch(() => ({ items: [] }))
    : { items: [] };

  const groups: MemoryPanel["groups"] = { personal: [], team: [], org: [] };
  for (const it of personal.items ?? []) {
    if (tierOf(it.scope_key) === "personal") groups.personal.push(shape(it));
  }
  for (const it of shared.items ?? []) {
    const t = tierOf(it.scope_key);
    if (t === "team" || t === "org") groups[t].push(shape(it));
  }

  return {
    principal: who.principal ?? "unknown",
    tenant: who.tenant_id ?? "unknown",
    groups,
  };
}
