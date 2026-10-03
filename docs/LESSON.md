# Lessons learned

A running log of non-obvious findings, newest first. Consolidate into docs and rules at each milestone.

## 2026-10-03 — providers
- On Windows, spawning an npm `.cmd` shim needs a shell. Instead, parse the shim and run its JS entry point with node: no shell, no injection surface.
- `claude -p` accepts `--system-prompt-file` and returns `structured_output` in the JSON envelope when given `--json-schema`.
- `codex exec --json`: the reply is the `item.completed` item with `item.type == "agent_message"`; failures arrive as `turn.failed`. In practice it takes 43–77 s per call, so it is a poor fast router brain.
- Sign in with ChatGPT plan tokens (preview) reject `temperature`, `max_output_tokens`, `metadata` and `user`, and function tools must be grouped in namespaces.
- Piper's flag is `--output_raw` (underscore) and it reads one utterance per line from stdin. Its GitHub releases publish no digests, so we pin SHA-256 values we computed ourselves.
- pnpm 12 ignores `onlyBuiltDependencies`; use `allowBuilds` in `pnpm-workspace.yaml`.

## 2026-10-03 — security
- A denylist shell-risk classifier will always have bypasses (quoting, newlines, exec flags). The real control is defense in depth: in the default `safe` level every shell command asks the user, and the classifier only decides what `trusted` / `full-auto` may auto-allow.
## 2026-10-03 (agent-host)
- **Bun ignores the `lookup` option** of `node:http(s).request`. To pin a vetted IP (DNS-rebinding defence), connect to the IP itself and set the `Host` header plus `servername` (TLS SNI and certificate check). This works in both Node and Bun.
- **WebSocket auth from a webview:** browsers cannot set headers, so the launch token travels as the subprotocol `jarvis.<token>`. The server must echo the chosen protocol back, or the browser drops the connection.
- **Claude Agent SDK:** `spawnClaudeCodeProcess` lets the host spawn the CLI itself, using a process group and recording PID and start time for orphan reaping (R7). The `env` passed to the SDK is what the child gets, so it must be allowlisted.
- **Codex SDK 0.160** has no approval callback. Until `codex app-server` approvals are wired, use a fail-safe mapping: safe → read-only; trusted → workspace-write only where the OS sandbox is strong.
- **Smart App Control** on Windows 11 can block a freshly compiled, unsigned `bun --compile` binary ("application control policy"). The first build ran; a rebuild with the same name was blocked. Plan code signing for releases.
- **`node:sqlite`** (Node 25) and **`bun:sqlite`** share prepare/run/all/get, so a small adapter covers both. Import them through a computed specifier so Vite never tries to resolve the other runtime's module.

## 2026-10-03
- **ChatGPT plan tokens:** Sign in with ChatGPT tokens work only with the **Responses API** (`store:false`, `stream:true`). They do **not** cover audio endpoints, so voice must use separate providers.
- **ChatGPT needs a relay:** ChatGPT accepts only **remote HTTPS** MCP servers. "Use Jarvis inside ChatGPT" therefore needs a relay: a Cloudflare Worker + Durable Object, with an outbound WebSocket from the desktop.
- **ElevenLabs models:** `eleven_v3` supports expressive audio tags but **not** the WebSocket `stream-input` endpoint. Use HTTP streaming for v3, and `eleven_flash_v2_5` over WebSocket for low latency.
- **Security from day one:** a voice assistant that can run shell commands needs safe-by-default permissions, inert deep links and "content is data" routing from the start (see `docs/security-model.md`).
