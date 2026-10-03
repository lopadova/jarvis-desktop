# Relay protocol (desktop ⇄ remote MCP relay)

The relay is a public HTTPS endpoint that ChatGPT (or any remote MCP client) calls. The desktop never accepts inbound connections: it keeps **one outbound WebSocket** to the relay, and the relay forwards tool calls through it. Reference implementation: `packages/relay` (Cloudflare Worker + Durable Object). The Vercel variant uses the same messages over long-polling.

## 1. Pairing

1. The desktop generates:
   - `pairId` — 16 random bytes, base32-lowercase (26 chars);
   - `secret` — 32 random bytes, base64url.

   It stores both in the OS keyring.
2. The desktop calls `POST {relay}/pair/register` with body `{ "pairId": "...", "secretHash": "<sha256(secret) hex>", "label": "Lorenzo's MacBook" }`.
   - `201 Created` → registered.
   - `409` → that pairId exists. The desktop retries with a new pairId.
   - The relay stores **only** the hash.
3. The desktop shows a **pairing code** to the user: the first 8 characters of `base32(sha256(secret))`, uppercase, which is short enough to type. It also shows a QR code of `{relay}/connect?pair=<pairId>`.
4. When the user adds the connector in ChatGPT, the OAuth authorize page of the relay asks for the pairing code. The relay checks it against the stored hash prefix. The issued OAuth grant is bound to that `pairId`.

## 2. Desktop link (WebSocket)

`GET {relay}/desktop/connect?pairId=<pairId>` with header `Authorization: Bearer <secret>` and `Upgrade: websocket`.
The relay verifies `sha256(secret) == secretHash` and routes the socket to the Durable Object named after `pairId`. Only one desktop socket per pair is kept: a newer connection replaces the older one.

All frames are JSON text messages:

| Direction | Message |
|---|---|
| desktop → relay | `{ "type": "hello", "version": "0.1.0", "tools": [ { "name": "jarvis_list_sessions", "readOnly": true }, ... ] }` — the tools the desktop is willing to expose (read-only by default, see settings `relayExposeWriteTools`) |
| relay → desktop | `{ "type": "call", "id": "<uuid>", "tool": "jarvis_list_sessions", "args": { ... }, "client": "chatgpt" }` |
| desktop → relay | `{ "type": "result", "id": "<uuid>", "ok": true, "content": [ { "type": "text", "text": "..." } ] }` or `{ "type": "result", "id": "<uuid>", "ok": false, "error": "message" }` |
| either | `{ "type": "ping", "t": 1730000000000 }` → `{ "type": "pong", "t": ... }` every 30 s |

Rules:
- Calls time out after **120 s** on the relay side (`jarvis_ask_user` may legitimately wait). The relay then answers the MCP client with an error.
- If no desktop is connected, `tools/call` returns an MCP error result with text "Jarvis is offline on your computer".
- `tools/list` on the relay returns only the tools from the last `hello`, with the MCP annotations `readOnlyHint` / `destructiveHint` taken from `@jarvis/core` `McpTools`.
- The desktop re-checks every call: it validates the arguments with the zod schema, applies the permission policy, and shows the call in the UI. A relayed call can never skip a required local approval.

## 3. Remote MCP endpoint (ChatGPT side)

- `POST {relay}/mcp` — MCP Streamable HTTP, protocol version per `@modelcontextprotocol/sdk`. Requires `Authorization: Bearer <oauth access token>` issued by the relay's OAuth provider.
- Methods handled: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`.
- OAuth metadata: `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`; dynamic client registration enabled (ChatGPT needs it).

## 4. Limits

- Max frame and argument size: 64 KB.
- Rate limit: 60 calls per minute per pair.
- Relay storage: the pair record (`pairId`, `secretHash`, `label`, `createdAt`), plus OAuth grants. **No tool arguments or results are persisted.**
