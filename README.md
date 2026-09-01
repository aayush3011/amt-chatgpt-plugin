# AMT Memory - ChatGPT plugin (Apps SDK)

Persistent, scoped agent memory (personal / team / org) for **ChatGPT**, backed by Azure
Cosmos DB and delivered through the Inference Platform gateway. This is the ChatGPT
counterpart of the [GitHub Copilot](https://github.com/aayush3011/amt-copilot-plugin),
[Claude Code](https://github.com/aayush3011/amt-claude-plugin), and
[Microsoft 365 Copilot](https://github.com/aayush3011/amt-m365-plugin) AMT plugins. It reuses
the same backend - gateway, OAuth discovery, and the AMT MCP server - and only swaps the
host-specific wrapper.

## Two ways to use it

| | What you get | Effort |
| --- | --- | --- |
| **Custom connector to the gateway** | All 14 AMT tools, via OAuth. No custom UI. | Config only |
| **This Apps SDK server** | The above core tools **plus** a rendered Personal/Team/Org memory widget | Build + host a small server |

Because the gateway already implements the MCP OAuth discovery contract ChatGPT expects
(`/.well-known/oauth-protected-resource`, Dynamic Client Registration, Authorization Code +
PKCE), the tools-only path is pure configuration - see [`connector/`](./connector). The Apps
SDK server in this repo exists for the one thing a plain connector cannot do: **serve custom
UI**.

## What the Apps SDK server is

A small stateless **Streamable HTTP MCP server** (`src/server.ts`) that:

- Serves a **skybridge widget** (`ui://widget/amt-memory.html`) - a React component
  (`web/widget.jsx`, bundled offline) that renders the user's memories grouped into
  **Personal / Team / Org** and talks to ChatGPT over the `window.openai` / `postMessage`
  bridge (MCP Apps standard).
- Registers a focused set of memory tools (`whoami`, `search_memories`, `get_memories`,
  `add_memory`) and a render tool (`show_memory_panel`) that owns the widget.
- **Forwards identity**: it holds no identity of its own. Each ChatGPT request's connector
  `Authorization` header is captured per-request and forwarded to the AMT gateway, which
  resolves `x-amt-context` from the real caller. `AMT_ACCESS_TOKEN` is honored for local dev.

The full 14-tool surface still lives on the gateway; this server is the UI + convenience
layer (analogous to the Copilot plugin's memory canvas).

## The known gap: capture is agent-gated

ChatGPT is a cloud-hosted surface with **no client-side per-turn hook**, so the deterministic
`capture` / `inject` hooks the CLI plugins use have nowhere to run. Recall works well; capture
degrades to "the agent decides" - the model is instructed (via `instructions/use-memory.md`
and the `add_memory` tool description) to record each turn. AMT's pipeline still owns what
becomes durable. Be explicit in any demo: capture here is agent-gated, not deterministic.

## Build and run

```bash
npm install
npm run build        # bundles the React widget, then compiles the server
AMT_ACCESS_TOKEN="<gateway token>" npm start   # serves http://localhost:8787/mcp
```

- `npm run build:widget` bundles `web/widget.jsx` (+ React) into `web/widget.build.js`.
- `npm run build:server` type-checks and compiles `src/*.ts` to `dist/`.
- `npm run typecheck` runs the TypeScript compiler with no emit.

Host the server on any HTTPS endpoint ChatGPT can reach, then add **that** URL as the custom
connector (Developer Mode / RBAC for internal use). For local testing, tunnel it (e.g. a dev
tunnel) so ChatGPT can reach `/mcp`.

## Layout

```text
src/
  server.ts    # Apps SDK MCP server: widget resource + memory tools + render tool (stateless HTTP)
  amt.ts       # gateway REST client + per-request identity forwarding + panel builder
  widget.ts    # composes the skybridge HTML from the bundled widget
web/
  widget.jsx   # the React memory-panel component (bundled offline by esbuild)
scripts/
  build-widget.mjs
connector/
  README.md            # add the gateway (or this server) as a custom connector
  amt-connector.json   # connector settings for reference
instructions/
  use-memory.md        # Custom GPT / Project instructions (recall + agent-gated capture)
```

## Requirements

- Node.js 18+ (global `fetch`, ESM).
- A ChatGPT workspace with Developer Mode enabled (admin) for custom connectors.
- Network reach from ChatGPT to wherever you host this server.

## How it talks to AMT

Nothing memory-related lives in this repo. The server and connector point at the deployed AMT
gateway (a public, Entra-auth-gated HTTPS endpoint). Memory data stays in Azure Cosmos DB,
reachable only through the authenticated gateway. This repo is the ChatGPT-facing wrapper.
