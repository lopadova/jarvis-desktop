# Progress

| Phase | Scope | Status |
|---|---|---|
| 0 | Foundations: design brief, product spec, security model, ADRs | ✅ #1 |
| 1 | Scaffold: monorepo, Tauri 2 shell, sidecar, CI | ✅ #2 |
| 1b | Pixel-perfect UI from the Claude Design handoff (`docs/design/handoff/`) | ✅ #10 |
| 2 | Brain & core (Sign in with ChatGPT, Claude, Codex, API keys, Ollama, router, memory, policy) | ✅ #2 |
| 3 | Agents (Claude Agent SDK, Codex app-server approvals, Home agent, approvals, SQLite) | ✅ #2, #7 |
| 4 | Voice out (ElevenLabs, Fish, OpenAI, Piper/Kokoro, cues, streaming replies) | ✅ #2, #7 |
| 5 | Voice in (PTT, wake word, VAD, Whisper, cloud STT) — AEC is a documented follow-up | ✅ #2 |
| 6 | MCP & interop (.mcpb, Cowork plugin, Cloudflare relay for ChatGPT + Vercel variant, relay e2e) | ✅ #2, #7 |
| 7 | Everyday features + suggestion chips (dictation, clipboard, screen, shopping, briefing, memory) | ✅ #12 |
| 8 | Release v0.1.0: README + docs-site with real screenshots, CHANGELOG, opt-in signing, Windows cross-build + Sandbox harness | ✅ #11, this release |

## Log
- 2026-10-03 — Phase 0 docs written:
  - `docs/design/DESIGN-BRIEF.md` (input for the design agent)
  - `docs/product-spec.md`
  - `docs/security-model.md`
  - ADRs 0001–0005
- 2026-10-03 — Docs & community (branch `feat/docs`):
  - `README.md` (WOW: banner, badges, everyday features first, moats, comparison, quickstarts a–h, examples, architecture, security, FAQ), `resources/jarvis-banner.svg`
  - `INSTALL_WITH_AI.md` (guide for AI assistants helping non-technical users) and `llms.txt`
  - `docs/guides/*` (13 guides), `docs/reference/{settings,mcp-tools,voice-commands}.md`, `docs/architecture/overview.md`, `docs/contributing/dev-setup.md`
  - `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, issue/PR templates, `FUNDING.yml`, `dependabot.yml`
  - Workflows: `ci.yml`, `release.yml` (draft release, unsigned installers, `.mcpb`, checksums), `docs.yml` (docs build check, no deploy), all actions SHA-pinned
  - `docs-site/` docmd site (WOW landing, 28 pages, semantic search, raw-HTML guard)
- 2026-10-03 — Claude Design handoff received and versioned in `docs/design/handoff/` (main: `Jarvis Desktop.dc.html` + component prototypes). To be implemented pixel-perfect in `apps/desktop/src` as phase 1b.
- 2026-10-03 — `packages/agent-host` (sidecar):
  - loopback JSON-RPC server, SQLite store, turn orchestrator, sessions
  - Claude/Codex/Home drivers, approvals, voice output, reminders
  - MCP handler, relay link client
  - 103 vitest tests covering R1–R12
  - Bun-compiled binary verified on Windows
- 2026-10-03 — `apps/desktop` (branch `feat/desktop`): Tauri 2 shell and provisional UI.
  - Rust: windows + materials, tray, shortcuts (PTT press/release), deep links (R3), sidecar supervision,
    shell IPC client with all `host.*` methods, rodio playback, on-device voice (sherpa-onnx KWS/VAD/Whisper)
    with model download + SHA-256, `--self-test`.
  - UI: React 19 / Tailwind v4 surfaces S1–S5 following the design brief contract, IPC client + mock mode, EN/IT.
  - Verified: vite build, tsc, vitest (27), cargo fmt/clippy/test on Linux (49 + 1 ignored model test),
    Windows cross-build (cargo-xwin) with 50 unit tests and `--self-test` passing on Windows 11.
- 2026-10-03 — Sidecar hardening (branch `feat/host-followups`):
  - Relay client now matches the Worker: unpairing calls `DELETE /pair/register`, and re-pairing revokes the old pairing first. It handles close codes `4000` (replaced, no reconnect loop), `4001` (pairing revoked) and `1009`/`1003` (backoff), and retries a `401` upgrade only at the slowest backoff. A pong watchdog drops dead links, results are capped at 64 KB by UTF-8 bytes, and stale-socket events are ignored.
  - Conformance tests against `packages/relay/src/shared` and an end-to-end test, `pnpm e2e:relay`: `wrangler dev`, the real sidecar, OAuth with the pairing code, `/mcp` tools/list and tools/call, unpair. 14/14 checks pass.
  - Codex runs through `codex app-server`. Command, file, permission, MCP-tool and legacy approvals go through classifyRisk → gate → approval. Also: thread resume, interrupt plus tree kill, the Jarvis MCP config sent over stdin, and the native `codex.exe` launched from npm shims. The SDK sandbox mapping remains as a fallback. Tests use a fake app-server process, and `scripts/codex-live-check.ts` verified a real turn.
  - `jarvis_ask_user` puts the calling session in `needs-input` and sets it back to running afterwards. The session still counts as live.
  - Router `answer`/`clarify`/`status` replies are spoken while they stream. An incremental JSON scan reads the brain deltas. Memory claims and invalid replies are never spoken early.
  - Windows: agent trees run in Job Objects through `bun:ffi`, verified under `bun run` and as a compiled binary. The connection file is restricted to the current user's SID with `icacls`.
  - Test counts: agent-host 159 vitest tests, relay 35, mcp 27. `pnpm e2e` passes 6/6.
- 2026-10-03 — Phase 1b (branch `feat/ui-pixel`): UI rebuilt from the Claude Design handoff.
  - `tokens.css` from the handoff's `tokens()` (dark/light × glass/solid, hue-driven accent, `--backdrop`, `--wallpaper`).
  - Orb, Listening Pill (all states, hide animation), Approval Card (countdown ring, R2 rules kept), Session Card/Panel,
    chat bubbles + system cards (inline approve/deny, timer countdown, briefing), Home (rail views: memory with undo,
    history, projects), composer (brain menu, click/hold mic, waveform), footer (usage meter, R11 mic indicator),
    Onboarding (5 steps, confetti), Settings (9 tabs, Full-auto confirm with checkbox), in-window toasts.
  - Settings/Onboarding code-split: main chunk 681 kB → 308 kB. Browser preview draws windows on the wallpaper.
  - New app icon and README banner from the handoff's Brand page; screenshots in `resources/screenshots/`.
- 2026-10-03 — Phase 7 (branch `feat/everyday`): every suggestion chip works end to end.
  - Fast path (EN + IT, no LLM): dictation start/stop, shopping list add/remove/list/clear, "forget today",
    "what do you know about me", "good morning" (briefing), "copy it".
  - Dictation: the next utterance is typed with `host.typeText` (never sent to a brain, never stored); stop phrases
    or Esc cancel; 60 s timeout; the pill shows a Dictation state (`listening.dictation`).
  - Clipboard questions: `host.clipboard.read` → brain with `wrapUntrusted('clipboard', …, 8000)`; spoken `speak` +
    ephemeral `text-result` card with Copy (`clipboard.write` → new `host.clipboard.write`).
  - Screen questions: opt-in `screenAccess` (default off); vision brain chosen before capture (primary, else a
    connected ChatGPT/local — never a paid API, R10; private mode local-only); `BrainRequest.images` implemented
    for ChatGPT plan/OpenAI (Responses `input_image`), Anthropic (base64 image blocks), local (`image_url`, clear
    error for text-only models); CLI brains refuse images. The shell downscales screenshots to ≤ 2 MB in memory.
  - Shopping list in SQLite (migration v3), `shopping.list/remove/clear`, `ui.shopping`, shopping card with live
    remove buttons. `ui.navigate` opens the Memory view; `ui.history` clears today's conversation in the UI.
  - Morning briefing: Home agent (or default agent) with a read-only task (weather only with a location memory,
    calendar + important mail through the user's MCP tools, ≤ 60 spoken words, final JSON block) → `briefing` card;
    plain-text fallback.
  - Docs: everyday guide, voice commands, settings (+ docs-site equivalents).
  - Tests: core 121, providers 68, agent-host 179, desktop 43 (workspace 438); Rust 53 (`png_within`);
    `pnpm e2e` 6/6.
- 2026-10-03 — v0.1.0 released (draft): all phases merged to `main`; 438 workspace tests + 35 relay + 52 Rust tests, `pnpm e2e` 6/6, `pnpm e2e:relay` 14/14.
- 2026-10-04 — Real-app e2e campaign on Windows 11 (`scripts/e2e-app`, 13 stages) and fixes it produced (PRs #26–#35 and the v0.1.2 PR): blank Settings/Sessions windows, QR library, chunked secrets for Sign in with ChatGPT, Whisper model fallback/refresh, voice-provider status and out-of-credit notices, ElevenLabs voice + parameters, History/Memory/Projects/About/Integrations gaps, silence-tag and self-echo filters, wake word by speech recognition. Verified on the real app: Claude Code, Codex, ChatGPT plan, MCP with real Claude, ElevenLabs, UI stage 11/11. Not verified on the real app: the wake word by speech recognition (Smart App Control blocked the new exe), macOS/Linux installers, Fish Audio (no API credit). v0.1.1 and v0.1.2 released as pre-releases.
