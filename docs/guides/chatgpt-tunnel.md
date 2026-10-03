# Use Jarvis from ChatGPT through a Cloudflare Tunnel

This option needs no relay code. `cloudflared` publishes Jarvis's local MCP HTTP endpoint at a public HTTPS address. It is free and quick to set up, but it is **less locked down than the relay** ([`packages/relay`](../../packages/relay/README.md)). Read "Security" below before you choose it.

```
ChatGPT ──HTTPS──▶ Cloudflare edge ──tunnel (outbound from your PC)──▶ cloudflared ──▶ http://127.0.0.1:8765/mcp ──▶ Jarvis
```

As with the relay, your computer opens no inbound port: `cloudflared` keeps an outbound connection to Cloudflare.

## Why ChatGPT needs a secret URL here

When you add a custom connector, ChatGPT offers **OAuth** or **No authentication** (as of 3 October 2026, [OpenAI Developer mode docs](https://developers.openai.com/api/docs/guides/developer-mode)). It can't send a static `Authorization: Bearer …` header. The local endpoint therefore has to accept its token in the path, `https://<tunnel>/mcp/<token>`. This is a **capability URL**: anyone who has the URL can call your exposed tools.

If you want OAuth plus a pairing code, deploy the relay instead. It also runs on the free plan.

## 1. Start the local HTTP endpoint

Jarvis must be running. In a terminal:

```bash
# A long random secret (43 characters). Keep it private.
export JARVIS_MCP_HTTP_TOKEN="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
node /path/to/jarvis-mcp.mjs --http --port 8765 --path-token
# → jarvis-mcp: listening on http://127.0.0.1:8765/mcp
```

PowerShell:

```powershell
$env:JARVIS_MCP_HTTP_TOKEN = node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
node C:\path\to\jarvis-mcp.mjs --http --port 8765 --path-token
```

What the endpoint enforces:
- It binds to `127.0.0.1` only.
- It rejects requests without the token: `401`. The token is compared in constant time.
- It rejects requests that carry a browser `Origin` header unless you allow that origin with `--allow-origin`: `403`.
- It sends every call to Jarvis with `origin: "http"`. Jarvis applies its normal permission policy and shows each call. Risky actions still need your click.

`jarvis-mcp.mjs` comes from the release asset `jarvis-mcp-bundle.zip`, or from `pnpm --filter @jarvis/mcp build` (`packages/mcp/dist/`).

## 2. Expose it with cloudflared

Install `cloudflared` from Cloudflare's [downloads page](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/). Packages: `brew install cloudflared` on macOS, `winget install --id Cloudflare.cloudflared` on Windows.

**Quick tunnel** (no account; the URL changes on every run):

```bash
cloudflared tunnel --url http://127.0.0.1:8765
# → https://<random-words>.trycloudflare.com
```

**Named tunnel** (free Cloudflare account, stable hostname on a domain you own):

```bash
cloudflared tunnel login
cloudflared tunnel create jarvis
cloudflared tunnel route dns jarvis jarvis.example.com
cloudflared tunnel run --url http://127.0.0.1:8765 jarvis
```

## 3. Add the connector in ChatGPT

1. Open **Settings → Apps & Connectors → Advanced settings** and turn on **Developer mode**.
2. Create a connector with:
   - **URL:** `https://<your-tunnel-host>/mcp/<JARVIS_MCP_HTTP_TOKEN>`
   - **Authentication:** No authentication. The token in the URL is the authentication.
3. Enable the connector in a chat.

## Security

- **Treat the URL as a password.** Don't paste it in shared chats or screenshots. Anyone holding it can use every tool Jarvis exposes over HTTP.
- **Rotate it.** Restart `jarvis-mcp --http` with a new `JARVIS_MCP_HTTP_TOKEN` and update the connector. The old URL stops working at once.
- **Stop the tunnel** when you don't need it (`Ctrl+C`). A quick tunnel dies with the process.
- **Logs.** The full URL path, token included, can show up in the Cloudflare and ChatGPT logs of *your* accounts. For OAuth with nothing secret in the URL, use the relay.
- **Optional extra layer.** With a named tunnel you can add a [Cloudflare WAF rule](https://developers.cloudflare.com/waf/custom-rules/) on your hostname that allows only `POST /mcp/*` and blocks everything else.
- **Local HTTP clients** (scripts and agents on your machine) don't need the tunnel or `--path-token`. Send `Authorization: Bearer <token>` to `http://127.0.0.1:8765/mcp`.

## Comparison

| | Relay (Cloudflare Worker) | Tunnel |
|---|---|---|
| Setup | Deploy button + pairing code | `cloudflared` + a terminal |
| ChatGPT authentication | OAuth 2.1 + pairing code | Secret URL |
| Works while the terminal is closed | Yes (Jarvis keeps the link) | No |
| Rate limiting, 64 KB caps, 120 s timeout | Built in | Only Jarvis's own checks |
| Cost | Free plan | Free |
