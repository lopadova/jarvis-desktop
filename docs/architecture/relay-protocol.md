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

## 5. Clarifications and extensions (reference implementation)

- **Hashing.** `secretHash` is `sha256` over the UTF-8 bytes of the base64url `secret` string, as lowercase hex. The pairing code is the first 8 characters of the RFC 4648 base32 encoding (uppercase, no padding) of those 32 digest bytes. The relay derives the code from `secretHash` and indexes it, so the authorize page needs only the code. Wrong codes are rate limited relay-wide (30 failures per 10 minutes).
- **Unpairing.** `DELETE {relay}/pair/register?pairId=<pairId>` with `Authorization: Bearer <secret>` returns `204`. The relay revokes every OAuth grant of the pair, deletes the pair record and keeps a **tombstone**: that `pairId` can never be registered again (`409`). The desktop always generates a new `pairId` when it pairs again.
- **Grant binding.** Each registration gets a random `generation` nonce. OAuth grants carry `{ pairId, generation }`, and the relay checks the generation on every `/mcp` request. A grant from an earlier registration gets `401 invalid_token`.
- **Frames.** A desktop frame larger than 64 KB closes the socket with code `1009`. Binary frames close it with `1003`. A newer desktop connection closes the older one with `4000`, and unpairing closes it with `4001`.
- **Registration abuse guard.** At most 60 registrations per hour per relay (`429` above that).
- **Desktop behaviour** (`packages/agent-host/src/relay.ts`, end-to-end test `pnpm e2e:relay`):
  - `4000` → the desktop stays offline (`reason: "replaced"`) and does not reconnect, so two computers never kick each other out in a loop. It reconnects at the next start or pairing.
  - `4001` → the desktop forgets the pairing (`status: "unpaired"`, `reason: "revoked"`).
  - `1009` / `1003` → logged as a protocol error and reconnected with backoff. The desktop never sends a frame over 64 KB: results are truncated by UTF-8 bytes, not characters.
  - HTTP `401` on the upgrade → `reason: "auth-failed"`, retried only at the slowest backoff (60 s).
  - A ping without a pong before the next ping (30 s) → the socket is dropped and reconnected.
  - Unpairing in the app always calls `DELETE /pair/register` first and drops the local pairing even when the relay is unreachable. Pairing again revokes the previous pairing first.

## 6. Long-poll variant (Vercel)

Serverless platforms that can't hold a WebSocket (`packages/relay/vercel`) carry the **same JSON messages** over two HTTP endpoints. Both authenticate the desktop like `/desktop/connect` does: `?pairId=<pairId>` and `Authorization: Bearer <secret>`.

| Request | Body | Response |
|---|---|---|
| `GET {relay}/desktop/poll?pairId=…` | — | Waits up to **25 s**. `200` with one `call` message (`{ "type": "call", "id", "tool", "args", "client" }`), or `204` when nothing arrived. The desktop polls again right away. |
| `POST {relay}/desktop/result?pairId=…` | one desktop → relay message: `hello`, `result` or `ping` | `204` for `hello` and `result`, `200 { "type": "pong", "t" }` for `ping`, `404` for a `result` whose `id` is not a pending call of this pair. |

Rules:
- The desktop sends `hello` once after it starts and again whenever its exposed tools change.
- The desktop counts as **online** while it polled within the last 60 s. Otherwise `tools/call` returns "Jarvis is offline on your computer".
- Calls are queued per pair. Results are kept only until the waiting `/mcp` request collects them, at most 130 s, and then expire. Arguments and results are never persisted beyond that.
- The limits from §4 and the timeout from §2 still apply.
- The relay checks for new calls and results at a fixed interval (default 2 s, `POLL_INTERVAL_MS`). This trades latency against the Redis command budget.
