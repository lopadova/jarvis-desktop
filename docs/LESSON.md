# Lessons learned

A running log of non-obvious findings, newest first. Consolidate into docs and rules at each milestone.

## 2026-10-03
- **ChatGPT plan tokens:** Sign in with ChatGPT tokens work only with the **Responses API** (`store:false`, `stream:true`). They do **not** cover audio endpoints, so voice must use separate providers.
- **ChatGPT needs a relay:** ChatGPT accepts only **remote HTTPS** MCP servers. "Use Jarvis inside ChatGPT" therefore needs a relay: a Cloudflare Worker + Durable Object, with an outbound WebSocket from the desktop.
- **ElevenLabs models:** `eleven_v3` supports expressive audio tags but **not** the WebSocket `stream-input` endpoint. Use HTTP streaming for v3, and `eleven_flash_v2_5` over WebSocket for low latency.
- **Security from day one:** a voice assistant that can run shell commands needs safe-by-default permissions, inert deep links and "content is data" routing from the start (see `docs/security-model.md`).
