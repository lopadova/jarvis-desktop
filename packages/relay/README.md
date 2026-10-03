# Jarvis relay: use Jarvis from ChatGPT

ChatGPT can only connect to MCP servers on the public internet over HTTPS. Jarvis runs on your computer, usually behind a router, and never opens an inbound port. This relay sits between them:

```
ChatGPT ──HTTPS + OAuth──▶ your relay (Cloudflare Worker) ◀──outbound WebSocket── Jarvis on your computer
```

- **Free.** It runs on the Cloudflare Workers Free plan: one Worker, SQLite-backed Durable Objects with WebSocket Hibernation, and one KV namespace.
- **Yours.** You deploy it to your own Cloudflare account. Nobody else's relay sees your calls.
- **Locked down.** ChatGPT has to finish OAuth by typing the **pairing code** that Jarvis shows. The relay stores only a hash of the pairing secret. Tool arguments and results are never stored. Limits: 64 KB per message, 60 calls per minute per computer, 120 s per call.
- **The desktop stays in charge.** Jarvis decides which tools are exposed (read-only by default). It shows every relayed call, and risky actions still need your click on the computer.

Protocol: [`docs/architecture/relay-protocol.md`](../../docs/architecture/relay-protocol.md). Design: [ADR 0005](../../docs/adr/0005-chatgpt-relay.md).

## Deploy in 5 minutes

### 1. Create a free Cloudflare account

Sign up at <https://dash.cloudflare.com/sign-up>. No credit card is needed for the Free plan.

### 2. Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/lopadova/jarvis-desktop/tree/main/packages/relay)

The button copies this folder into a new repository on your GitHub account and creates the KV namespace and the Durable Objects for you. Then it deploys. Keep the default name `jarvis-relay` or choose your own.

Or deploy from a terminal:

```bash
git clone https://github.com/lopadova/jarvis-desktop
cd jarvis-desktop/packages/relay
npm install            # or: pnpm install
npx wrangler login
npx wrangler deploy    # creates the KV namespace automatically on first deploy
```

### 3. Copy the URL

After the deploy finishes, Cloudflare shows your Worker URL, for example `https://jarvis-relay.<your-subdomain>.workers.dev`. Open it in a browser. You should see "Jarvis relay … It is running."

### 4. Pair Jarvis

In Jarvis open **Settings → ChatGPT relay**, paste the URL and click **Pair**. Jarvis registers with the relay, opens its outbound connection, and shows an 8-character **pairing code**.

### 5. Add the connector in ChatGPT

1. In ChatGPT on the web, open **Settings → Apps & Connectors → Advanced settings** and turn on **Developer mode**.
2. Create a connector with:
   - **MCP server URL:** `https://jarvis-relay.<your-subdomain>.workers.dev/mcp`
   - **Authentication:** OAuth. ChatGPT registers itself through dynamic client registration.
3. ChatGPT opens the relay's page. Type the pairing code and click **Connect**.
4. In a chat, enable the connector and ask, for example, "What is Jarvis working on?"

The relay also serves `/connect`, a page that repeats these instructions with your exact URL. It is the page Jarvis's QR code opens.

## ChatGPT plans (honest version, as of 3 October 2026)

- OpenAI's developer documentation ([Developer mode](https://developers.openai.com/api/docs/guides/developer-mode)) says Developer mode is "available to Pro, Plus, Business, Enterprise, and Education accounts on the web" and gives "full MCP client support for all tools, both read and write". ChatGPT asks you to confirm write actions by default.
- The ChatGPT Help Center describes publishing MCP apps with write actions to a workspace as a Business / Enterprise / Edu feature that is still rolling out in beta. Availability has changed several times. If write tools don't show up on your plan, use Jarvis's default **read-only** exposure (`jarvis_list_sessions`, `jarvis_session_result`, `jarvis_recall`), which every plan with Developer mode supports.
- The free ChatGPT plan has no Developer mode, so you can't add custom connectors on it.

Check OpenAI's current documentation before you rely on write tools.

## Free-plan limits (as of 3 October 2026)

| Resource | Workers Free | Usage of one paired computer |
|---|---|---|
| Worker requests | 100,000 / day | one per MCP request |
| Durable Object requests | 100,000 / day | incoming WebSocket messages count at a 20:1 ratio. A ping every 30 s is about 150 requests a day |
| DO duration | 13,000 GB-s / day | close to zero while idle, thanks to hibernation |
| SQLite storage | 5 GB | a few KB |
| KV | 100,000 reads / 1,000 writes per day | OAuth tokens only |

## Configuration

`wrangler.jsonc` `vars`:

| Variable | Default | Meaning |
|---|---|---|
| `CALL_TIMEOUT_MS` | `120000` | How long the relay waits for the desktop's answer to one call |
| `CALLS_PER_MINUTE` | `60` | Rate limit per paired computer |
| `PUBLIC_URL` | request origin | Set it if you put the relay behind a custom domain and also keep the workers.dev URL, so OAuth tokens have one fixed audience |

## Endpoints

| Endpoint | Who | Auth |
|---|---|---|
| `POST /pair/register` | Jarvis | none (it registers a pair; at most 60 registrations an hour per relay) |
| `DELETE /pair/register?pairId=` | Jarvis | `Bearer <pair secret>`. Revokes every OAuth grant of the pair, then deletes it. The pairId can't be registered again |
| `GET /desktop/connect?pairId=` | Jarvis (WebSocket) | `Bearer <pair secret>` |
| `POST /mcp` | ChatGPT | OAuth access token. The grant is bound to the pair and its registration |
| `/authorize`, `/oauth/token`, `/oauth/register`, `/.well-known/oauth-*` | ChatGPT | OAuth 2.1 + PKCE (`@cloudflare/workers-oauth-provider`) |
| `/`, `/connect`, `/health` | anyone | none |

## Develop and test

```bash
pnpm --filter @jarvis/relay test        # vitest + @cloudflare/vitest-pool-workers (runs in workerd) + Vercel variant tests
pnpm --filter @jarvis/relay typecheck
pnpm --filter @jarvis/relay dev         # wrangler dev on http://localhost:8787
pnpm --filter @jarvis/relay smoke       # in another terminal: pairs a fake desktop, does OAuth, calls a tool
```

`@cloudflare/vitest-pool-workers` 0.22 requires vitest 4.1, so this package pins vitest `~4.1` and is excluded from the root vitest workspace. The tool catalogue in `src/shared/catalog.generated.ts` is generated from `@jarvis/core` with `pnpm --filter @jarvis/mcp gen:relay`. The relay doesn't depend on workspace packages because the Deploy button copies only this folder. `src/shared/` is copied to `vercel/src/shared/` with `pnpm --filter @jarvis/relay sync:vercel`.

## Alternatives

- **Vercel + Upstash Redis** (free tiers): [`vercel/README.md`](vercel/README.md). Uses long-polling instead of a WebSocket.
- **Cloudflare Tunnel**: no relay code at all. [`docs/guides/chatgpt-tunnel.md`](../../docs/guides/chatgpt-tunnel.md).
