// server.ts - the AMT Memory Apps SDK MCP server for ChatGPT.
//
// This is the *UI + convenience* layer of the ChatGPT integration. The full 14-tool AMT
// surface already lives on the gateway's own MCP endpoint (which ChatGPT can also add
// directly as a custom connector - see connector/). This server adds what the base connector
// cannot: a rendered "memory panel" widget (MCP Apps / skybridge) plus a few core memory
// tools, all proxied to the AMT gateway with the caller's forwarded identity.
//
// Transport is stateless Streamable HTTP: one MCP server + transport per POST, with the
// request's Authorization header captured into AsyncLocalStorage so amt.ts forwards it.

import express, { type Request, type Response } from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import {
  amt,
  loadMemoryPanel,
  requestContext,
  type MemoryItem,
  type WhoAmI,
} from "./amt.js";
import { WIDGET_URI, widgetHtml } from "./widget.js";

const SERVER_INSTRUCTIONS = [
  "AMT Memory gives this ChatGPT user persistent, scoped memory (personal / team / org) over the Agent Memory Toolkit gateway.",
  "Before a substantive task, call search_memories with the request's key terms and treat what returns as established fact for this user.",
  "This platform has no automatic capture hook, so capture is agent-gated: after a meaningful exchange, append the user turn and your reply with add_memory using one stable thread_id per conversation. Do not judge importance - AMT's pipeline decides what becomes durable.",
  "To show the user what is remembered, call show_memory_panel (it renders the Personal/Team/Org widget). Never ask the user for identity, tenant, or scope; the gateway resolves it from their sign-in.",
].join(" ");

const memoryShape = {
  id: z.string(),
  scope_key: z.string(),
  type: z.string(),
  content: z.string(),
};

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "amt-memory", version: "0.1.0" },
    {
      instructions: SERVER_INSTRUCTIONS,
      capabilities: { tools: {}, resources: {} },
    },
  );

  // --- widget resource (skybridge HTML loaded in ChatGPT's iframe) --------------------
  server.registerResource(
    "amt-memory-widget",
    WIDGET_URI,
    { description: "AMT Memory panel: Personal / Team / Org memories." },
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: "text/html+skybridge",
          text: widgetHtml(),
          _meta: { "openai/widgetPrefersBorder": true },
        },
      ],
    }),
  );

  // --- data tools (useful without UI) -------------------------------------------------
  server.registerTool(
    "whoami",
    {
      title: "Who am I (AMT)",
      description: "Report the caller's AMT-resolved identity (tenant / principal / groups).",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        return textResult(await amt<WhoAmI>("/whoami"));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "search_memories",
    {
      title: "Search memories",
      description:
        "Search this user's AMT memories (facts + episodes). Call before a task with the request's key terms.",
      inputSchema: { query: z.string().describe("Search terms, usually the key terms of the request.") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query }) => {
      try {
        const out = await amt<{ items?: MemoryItem[] }>("/search", {
          method: "POST",
          body: { query, top_k: 10 },
        });
        return textResult(out.items ?? out);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_memories",
    {
      title: "Recent memories",
      description: "List this user's most recent AMT memories (no query).",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const out = await amt<{ items?: MemoryItem[] }>("/memories?recent_k=20");
        return textResult(out.items ?? out);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "add_memory",
    {
      title: "Record a turn",
      description:
        "Append one conversation turn to AMT (capture is agent-gated on ChatGPT). role is 'user' or 'agent'; use one stable thread_id per conversation. Do not pre-summarize; the pipeline distills.",
      inputSchema: {
        thread_id: z.string().describe("Stable id for the current conversation."),
        role: z.enum(["user", "agent"]).describe("Who produced the turn."),
        content: z.string().describe("The verbatim turn text."),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async ({ thread_id, role, content }) => {
      try {
        return textResult(await amt("/memory", { method: "POST", body: { thread_id, role, content } }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // --- render tool (owns the widget template) -----------------------------------------
  server.registerTool(
    "show_memory_panel",
    {
      title: "Show memory panel",
      description:
        "Render the AMT Memory panel (Personal / Team / Org) for the user. Use when the user asks what you remember or to review their memories.",
      inputSchema: {},
      outputSchema: {
        principal: z.string(),
        tenant: z.string(),
        groups: z.object({
          personal: z.array(z.object(memoryShape)),
          team: z.array(z.object(memoryShape)),
          org: z.array(z.object(memoryShape)),
        }),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: {
        // MCP Apps standard + ChatGPT compatibility alias linking this tool to the widget.
        "ui": { resourceUri: WIDGET_URI },
        "openai/outputTemplate": WIDGET_URI,
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Loading your memories...",
        "openai/toolInvocation/invoked": "Here's what AMT remembers.",
      },
    },
    async () => {
      try {
        const panel = await loadMemoryPanel();
        const total =
          panel.groups.personal.length + panel.groups.team.length + panel.groups.org.length;
        return {
          structuredContent: panel as unknown as { [key: string]: unknown },
          content: [
            {
              type: "text" as const,
              text: `Loaded ${total} memories for ${panel.principal} (personal ${panel.groups.personal.length}, team ${panel.groups.team.length}, org ${panel.groups.org.length}).`,
            },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  return server;
}

function methodNotAllowed() {
  return {
    jsonrpc: "2.0" as const,
    error: { code: -32000, message: "Method not allowed. Use POST for the stateless MCP endpoint." },
    id: null,
  };
}

async function handleMcpPost(req: Request, res: Response): Promise<void> {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request failed:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
}

function main(): void {
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  app.post("/mcp", (req, res) => {
    // Capture the caller's connector Authorization header for the whole request so amt.ts
    // forwards the real user identity to the gateway.
    void requestContext.run({ authHeader: req.header("authorization") ?? undefined }, () =>
      handleMcpPost(req, res),
    );
  });

  app.get("/mcp", (_req, res) => res.status(405).json(methodNotAllowed()));
  app.delete("/mcp", (_req, res) => res.status(405).json(methodNotAllowed()));
  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  const port = Number(process.env.PORT ?? 8787);
  app.listen(port, () => {
    console.log(`AMT Memory (ChatGPT Apps SDK) MCP server listening on :${port}/mcp`);
  });
}

main();
