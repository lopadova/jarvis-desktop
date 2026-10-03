# Jarvis relay on Vercel (alternative)

The same relay as the Cloudflare Worker in [`../`](../README.md), built on plain **Vercel Functions** (Node.js runtime, no framework) and **Upstash Redis** (REST API), both on free tiers.

Vercel Functions can't hold WebSockets, so the desktop **long-polls**:

```
ChatGPT ──HTTPS + OAuth──▶ /mcp ──LPUSH call──▶ Upstash Redis ◀──GET /desktop/poll (≤ 25 s)── Jarvis
                                 ◀──result:<id>──               ──POST /desktop/result──────▶
```

Messages have the same JSON shapes as the WebSocket protocol. See §5 of [`docs/architecture/relay-protocol.md`](../../../docs/architecture/relay-protocol.md).

> [!WARNING]
> **Status in v0.1: relay side only.** This Vercel relay is implemented and tested, but the Jarvis desktop app connects only over WebSocket and does not speak the long-poll endpoints yet, so it cannot pair with this variant today. Use the Cloudflare relay or a Cloudflare Tunnel. The long-poll desktop client is planned.

**Prefer the Cloudflare relay if you can.** It has lower latency, no polling, and a much smaller free-tier footprint.

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/lopadova/jarvis-desktop/tree/main/packages/relay/vercel&project-name=jarvis-relay&env=UPSTASH_REDIS_REST_URL,UPSTASH_REDIS_REST_TOKEN&envDescription=Upstash%20Redis%20REST%20credentials%20(free%20database%20at%20upstash.com))

1. Create a free Redis database at <https://console.upstash.com>, or add the **Upstash** integration from the Vercel Marketplace, which sets the variables for you.
2. Click the button. Vercel copies this folder into a new repository and asks for the variables below.
3. Copy the deployment URL, for example `https://jarvis-relay.vercel.app`, and pair it in **Jarvis › Settings › Integrations › ChatGPT relay** (once the desktop long-poll client ships, see the status note above).
4. In ChatGPT (Developer mode), add a connector with the URL `https://jarvis-relay.vercel.app/mcp` and OAuth. Then type the pairing code.

Manual deploy: `cd packages/relay/vercel && npx vercel deploy --prod`.

## Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | yes* | Upstash REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | yes* | Upstash REST token (secret) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | * | Accepted instead of the two above (the names set by the Vercel Marketplace integration) |
| `PUBLIC_URL` | no | Canonical origin, if you use a custom domain |
| `POLL_INTERVAL_MS` | no | How often a waiting request checks Redis. Default `2000` |

## Cost on the free tiers (as of 3 October 2026)

- **Upstash Redis free:** 500,000 commands a month, 256 MB. Each Redis check costs one command. A desktop that is online and idle polls about once every 2 s (`POLL_INTERVAL_MS`). That is roughly 1.3 million commands a month around the clock, or about 430,000 if Jarvis runs 8 hours a day. Raise `POLL_INTERVAL_MS` (say 5000) to cut that further, at the cost of up to 5 s extra latency per call. This budget is the main reason the Cloudflare relay is the default.
- **Vercel Hobby:** each long-poll keeps a function busy for up to 25 s, and a tool call waits up to 120 s (`maxDuration` is 150 s in `vercel.json`). With Fluid compute, waiting time is billed as provisioned memory, not active CPU. Check your usage page in the first days.

## What it implements

- The same pairing, the same limits (64 KB, 60 calls per minute, 120 s) and the same `/mcp` handler as the Worker. The handler code is shared and copied into `src/shared/` (`pnpm --filter @jarvis/relay sync:vercel`).
- A small OAuth 2.1 server in `src/oauth.ts`: RFC 8414 and RFC 9728 metadata, dynamic client registration, authorization code with mandatory PKCE S256, and refresh-token rotation. The consent step is the pairing code. Tokens and codes are stored only as SHA-256 hashes, and every grant is bound to the pair and its registration `generation`. Unpairing (`DELETE /pair/register`) removes the pair and leaves a permanent tombstone, so every existing token stops working immediately.
- Tests: `pnpm --filter @jarvis/relay test`, project `relay-vercel`, which uses an in-memory store.
