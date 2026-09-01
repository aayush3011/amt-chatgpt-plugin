# Adding AMT Memory to ChatGPT as a custom connector

There are two ways to use AMT Memory in ChatGPT. Most of the value ("connect and use the
tools") is **configuration only**, because the AMT gateway already implements the MCP OAuth
discovery contract ChatGPT expects.

## Path 1 - tools only (config only, no code)

Add the gateway's MCP endpoint directly as a custom connector. This exposes the full 14-tool
AMT surface; there is no custom widget on this path.

1. A workspace **admin enables Developer Mode** and grants you access (RBAC). See the OpenAI
   docs for [MCP and connectors](https://developers.openai.com/plugins).
2. **Settings -> Connectors -> Create / Add custom connector.**
3. Enter the MCP server URL:
   `https://reranker-api-h2b5czhkfkcphnf4.westus3-01.azurewebsites.net/inference/memory/mcp/`
4. Choose **OAuth** for authentication. ChatGPT reads the gateway's
   `/.well-known/oauth-protected-resource`, performs Dynamic Client Registration, and starts
   an **Authorization Code + PKCE** flow. Complete the **Microsoft (Entra) sign-in** in the
   browser so the gateway can mint a token and resolve your `x-amt-context`.
5. In a chat, enable the connector and ask *"call the AMT whoami tool"* to confirm your
   principal and tenant.

`amt-connector.json` in this folder captures these settings for reference.

## Path 2 - tools + memory widget (this repo's Apps SDK server)

ChatGPT renders custom UI only from a UI resource returned by an MCP server. The gateway's
base endpoint returns tools but not a widget, so to get the **Personal / Team / Org memory
panel** you run the small Apps SDK server in this repo (`../src/server.ts`) and add *its* URL
as the connector instead. It proxies the gateway with your forwarded identity and returns the
skybridge widget. See [`../README.md`](../README.md) for build and host steps.

## Identity note (the open item)

A ChatGPT user is an OpenAI account, not an Entra principal. The Microsoft sign-in in step 4
is what bridges them. Signing a Microsoft work identity into a third-party product is an
organizational policy decision, not an engineering one - resolve it before broad rollout.
This is the same flow already verified for Claude Code.
