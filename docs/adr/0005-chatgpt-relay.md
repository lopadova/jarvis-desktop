# ADR 0005 — Remote MCP relay for ChatGPT on Cloudflare Workers (free tier)

- Status: Accepted · Date: 2026-10-03

## Context
ChatGPT can only connect to **remote HTTPS** MCP servers. Jarvis runs on the user's computer, often behind NAT, and must not open inbound ports.

## Decision
`packages/relay` is a Cloudflare Worker with one Durable Object per paired desktop. How a call flows:
1. The desktop keeps an **outbound WebSocket** open to its Durable Object. The hibernation API keeps this within the free tier.
2. ChatGPT calls `https://<name>.<account>.workers.dev/mcp` over Streamable HTTP.
3. The Worker authenticates the caller with OAuth (`workers-oauth-provider`).
4. It forwards the JSON-RPC call to the desktop over the socket and streams the result back.

Safeguards:
- **Pairing:** the desktop shows a QR code or a short code. The relay stores only a hash of the pairing secret.
- **Tool exposure** is filtered on the desktop and is read-only by default.
- **Visibility:** every relayed call appears in the desktop UI.
- **Deploy:** a "Deploy to Cloudflare" button, plus `wrangler deploy` instructions.

Alternatives documented for advanced users:
- **Vercel (free tier):** Functions cannot hold WebSockets, so the desktop long-polls a queue on Upstash Redis (free tier). Latency is higher.
- **Cloudflare Tunnel (`cloudflared`):** no code needed; it exposes the local MCP HTTP endpoint directly. Auth must still be turned on.

## Consequences
- \+ No inbound ports, free hosting, works behind NAT.
- − One more deployable to maintain.
- − ChatGPT plan limits on write tools for Plus/Pro must be documented honestly.
