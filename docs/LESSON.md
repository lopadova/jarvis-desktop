# Lessons learned

A running log of non-obvious findings, newest first. Consolidate into docs and rules at each milestone.

## 2026-10-03 — everyday features (phase 7)
- **Captured content must not leak into history by the back door.** The router path persists every turn's `said` and every chat message. For clipboard/screen answers and dictation the derived text is as sensitive as the source, so those replies go out as *ephemeral* chat events (not stored) and the turn keeps only `heard` + action. Tests grep the SQLite rows for a marker string from the clipboard.
- **Pick the brain before capturing.** Choosing the vision brain (and checking private mode) before calling `host.screenshot` means a refused request never takes a screenshot at all — simpler to reason about than "capture, then drop".
- **Vision fallback vs R10:** falling back from Claude Code/Codex (no images) to the OpenAI/Anthropic API would be a silent paid fallback. Only the ChatGPT plan and the local model are tried; otherwise Jarvis explains.
- **`norm()` drops commas**, so "milk, eggs and bread" became "milk eggs". Keep commas when normalising for list parsing and turn them into " and " after the wake word is stripped.
- **Regex escapes through shell heredocs:** writing TypeScript through a Python heredoc turned the regex word boundary `\b` into a literal backspace character (0x08), and the code still compiled. Use the editor tool for regex-heavy code, and search for control characters when a regex silently stops matching.
- **System TTS splits replies into sentences** (`host.systemSpeak` per sentence): assert on the joined spoken text, not on `spoken()[0]`.
- **docmd builds 0 pages from a path with spaces** (`Visual Basic/…`) without failing. Building a copy under a space-free path generates all pages; CI is unaffected.

## 2026-10-03 — host follow-ups
- **`codex app-server`** (codex-cli 0.159) speaks newline-delimited JSON-RPC **without** the `"jsonrpc"` field. The handshake is `initialize`, then the `initialized` notification. `codex app-server generate-ts --out <dir>` produces the exact protocol types, which beats the README.
  - **Approvals:** `item/commandExecution/requestApproval` and `item/fileChange/requestApproval` take `{decision: accept|decline}`. The file-change request carries **no paths**: take them from the `fileChange` item announced by `item/started` with the same `itemId`.
  - **MCP tool approvals** arrive as `mcpServer/elicitation/request` with `_meta.codex_approval_kind = "mcp_tool_call"`. They carry no call id, so match them by server + tool name and ask whenever the match is ambiguous.
  - **Policy:** `approvalPolicy: "untrusted"` plus `approvalsReviewer: "user"` makes Codex ask for everything outside its built-in read-only list.
  - **Config:** `thread/start.config` accepts `mcp_servers`, so secrets go over stdin instead of `-c` argv.
  - **Shells:** on Windows the command arrives wrapped (`pwsh.exe -Command '…'`). `commandActions[].command` has the bare command for display.
- **A command approval with a network context** is still a shell command. Classify the command itself, then raise the risk for network or data egress. Never downgrade it to a network-only request: that made `curl … | sh` voice-approvable.
- **Windows npm shims** (`codex`, `codex.cmd`) cannot be spawned without a shell. The real binary is under `node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/<triple>/bin/codex.exe`.
- **`bun:ffi` works in `bun build --compile` binaries.** `dlopen('kernel32.dll')` is enough for Job Objects. Don't set `KILL_ON_JOB_CLOSE` if agents should leave dev servers running. A job also catches orphaned grandchildren, which `taskkill /T` misses once the parent is gone.
- **Async-loaded capabilities:** if a constructor fills a field from a promise, synchronous calls right after construction see `null`. When the value is already there, set it synchronously.
- **Windows tools:** in Git Bash `whoami` is the MSYS one. Call `%SystemRoot%\System32\whoami.exe` and `icacls.exe` by absolute path. `icacls <file> /inheritance:r /grant:r *<SID>:F` leaves exactly one ACE. Create the file empty, restrict it, then write the secret.
- **Relay frame size:** the relay limit is 64 KB **bytes**, while `string.length` counts UTF-16 units. A result with multi-byte text under 64 K characters can still trip `1009`.
- **`ws` client:** without an `unexpected-response` listener a 401 upgrade only surfaces as a generic error. With one, read `res.statusCode` and `terminate()` the socket yourself.
- **Local relay e2e:** `wrangler dev --ip 127.0.0.1 --port <free> --persist-to <tmp>` works without a Cloudflare login. The OAuth consent cookie works over plain http on loopback. On Windows, kill the wrangler tree with `taskkill /T` (it spawns `workerd`).
- **Streaming speech** from a structured router reply is only safe for actions the grounding check never rewrites (answer/clarify/status). Gate it on the complete `action` value, hold memory-claim sentences, and stop speech if the final parse fails.
## 2026-10-03 — ui-pixel (phase 1b)
- **Unlayered element CSS beats Tailwind v4 utilities.** A plain `button { font: inherit }` in `globals.css` silently overrode every `text-[12px]`/`font-semibold` on buttons, because utilities live in `@layer utilities`. Put element defaults in `@layer base`.
- **The handoff's inline styles are `content-box`.** A `width:212px; padding:12px 10px` sidebar is 232 px wide, and a `960×680` window with a 1 px border is 962×682. Tailwind's preflight is `border-box`, so add the padding/border when porting.
- **Inline `animation` shorthands reset `animation-play-state`.** Pausing on `visibilitychange` (and reduced motion) needs `!important` in the global rule; keep a targeted `biome-ignore` with the reason.
- **Comparing with the design:** serve `docs/design/handoff/` with a static server (not `file://`) and drive both pages with Playwright at the same viewport; element screenshots of `[data-window]` make side-by-side checks easy.

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
- **Codex SDK 0.160** has no approval callback. Until `codex app-server` approvals are wired, use a fail-safe mapping: safe → read-only; trusted → workspace-write only where the OS sandbox is strong. (Now wired, see "host follow-ups"; the mapping stays as the fallback.)
- **Smart App Control** on Windows 11 can block a freshly compiled, unsigned `bun --compile` binary ("application control policy"). The first build ran; a rebuild with the same name was blocked. Plan code signing for releases.
- **`node:sqlite`** (Node 25) and **`bun:sqlite`** share prepare/run/all/get, so a small adapter covers both. Import them through a computed specifier so Vite never tries to resolve the other runtime's module.

## 2026-10-03
- **sherpa-onnx on Windows + Tauri:** the official `sherpa-onnx` crate downloads prebuilt `/MT` static libs (no bindgen/libclang). Do **not** add `+crt-static`: `tauri-build` already links vcruntime statically with a dynamic UCRT, and adding crt-static drops the UCRT (unresolved `fmod`, `sin`, …).
- **sherpa-onnx streams abort on a sample-rate change** ("You changed the input sampling rate!!" → process exit). Always feed one fixed rate (16 kHz) per stream.
- **KWS keywords must be BPE-tokenised** for the gigaspeech Zipformer KWS model: "JARVIS" → `▁JA R VI S` (computed with sentencepiece from the model's `bpe.model`). Format: `tokens :boost #threshold @LABEL`.
- **Windows Smart App Control** blocks freshly compiled unsigned binaries (cargo build scripts, proc-macro DLLs, the Tauri CLI `.node`) with os error 4551. Workaround used here: build/test in a Linux container and cross-build Windows with `cargo-xwin`. The cross-built exe was allowed to run.
- **cargo-xwin on Linux:** alias `PathCch.lib` → `pathcch.lib` in the xwin SDK dir (case-sensitive FS).
- **UNC paths leak NTLM:** validate `host.open` / terminal paths lexically (only `Disk`/`VerbatimDisk` prefixes, `file://` with no remote host) *before* `canonicalize()` touches the filesystem.
- **Windows Terminal `wt` splits arguments on `;`**: escape it as `\;`. Never pass directories through `cmd /C start` (cmd re-parses the line); set `current_dir` and use `CREATE_NEW_CONSOLE` instead.- **ChatGPT plan tokens:** Sign in with ChatGPT tokens work only with the **Responses API** (`store:false`, `stream:true`). They do **not** cover audio endpoints, so voice must use separate providers.
- **ChatGPT needs a relay:** ChatGPT accepts only **remote HTTPS** MCP servers. "Use Jarvis inside ChatGPT" therefore needs a relay: a Cloudflare Worker + Durable Object, with an outbound WebSocket from the desktop.
- **ElevenLabs models:** `eleven_v3` supports expressive audio tags but **not** the WebSocket `stream-input` endpoint. Use HTTP streaming for v3, and `eleven_flash_v2_5` over WebSocket for low latency.
- **Security from day one:** a voice assistant that can run shell commands needs safe-by-default permissions, inert deep links and "content is data" routing from the start (see `docs/security-model.md`).
