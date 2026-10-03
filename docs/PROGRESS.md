# Progress

| Phase | Scope | Status |
|---|---|---|
| 0 | Foundations: design brief, product spec, security model, ADRs | ✅ in review |
| 1 | Scaffold: monorepo, Tauri 2 shell, sidecar, CI | ⏳ next |
| 1b | **UI pixel-perfect** from the Claude Design handoff in `docs/design/handoff/` (replaces the provisional UI) | ✅ branch `feat/ui-pixel` |
| 2 | Brain & core (Sign in with ChatGPT, Claude, Codex, API keys, Ollama, router, memory, policy) | — |
| 3 | Agents (Claude Agent SDK, Codex SDK, Home agent, approvals, SQLite) | — |
| 4 | Voice out (ElevenLabs, Fish, OpenAI, local, cues, streaming) | — |
| 5 | Voice in (PTT, wake word, VAD, Whisper, cloud STT, AEC) | — |
| 6 | MCP & interop (.mcpb, Cowork plugin, Cloudflare relay for ChatGPT) | — |
| 7 | Everyday features + suggestion chips | — |
| 8 | Release v0.1.0, README, docs-site — **real app screenshots taken while testing** (home, pill states, approval card, sessions, onboarding, settings) added to README and docs-site "See it" | — |

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
  - Workflows: `ci.yml`, `release.yml` (draft release, unsigned installers, `.mcpb`, checksums), `docs.yml` (Cloudflare Pages), all actions SHA-pinned
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
- 2026-10-03 — Phase 1b (branch `feat/ui-pixel`): UI rebuilt from the Claude Design handoff.
  - `tokens.css` from the handoff's `tokens()` (dark/light × glass/solid, hue-driven accent, `--backdrop`, `--wallpaper`).
  - Orb, Listening Pill (all states, hide animation), Approval Card (countdown ring, R2 rules kept), Session Card/Panel,
    chat bubbles + system cards (inline approve/deny, timer countdown, briefing), Home (rail views: memory with undo,
    history, projects), composer (brain menu, click/hold mic, waveform), footer (usage meter, R11 mic indicator),
    Onboarding (5 steps, confetti), Settings (9 tabs, Full-auto confirm with checkbox), in-window toasts.
  - Settings/Onboarding code-split: main chunk 681 kB → 308 kB. Browser preview draws windows on the wallpaper.
  - New app icon and README banner from the handoff's Brand page; screenshots in `resources/screenshots/`.
