# Progress

| Phase | Scope | Status |
|---|---|---|
| 0 | Foundations: design brief, product spec, security model, ADRs | ✅ in review |
| 1 | Scaffold: monorepo, Tauri 2 shell, sidecar, CI | ⏳ next |
| 2 | Brain & core (Sign in with ChatGPT, Claude, Codex, API keys, Ollama, router, memory, policy) | — |
| 3 | Agents (Claude Agent SDK, Codex SDK, Home agent, approvals, SQLite) | — |
| 4 | Voice out (ElevenLabs, Fish, OpenAI, local, cues, streaming) | — |
| 5 | Voice in (PTT, wake word, VAD, Whisper, cloud STT, AEC) | — |
| 6 | MCP & interop (.mcpb, Cowork plugin, Cloudflare relay for ChatGPT) | — |
| 7 | Everyday features + suggestion chips | — |
| 8 | Release v0.1.0, README, docs-site | — |

## Log
- 2026-10-03 — Phase 0 docs written:
  - `docs/design/DESIGN-BRIEF.md` (input for the design agent)
  - `docs/product-spec.md`
  - `docs/security-model.md`
  - ADRs 0001–0005
- 2026-10-03 — `apps/desktop` (branch `feat/desktop`): Tauri 2 shell and provisional UI.
  - Rust: windows + materials, tray, shortcuts (PTT press/release), deep links (R3), sidecar supervision,
    shell IPC client with all `host.*` methods, rodio playback, on-device voice (sherpa-onnx KWS/VAD/Whisper)
    with model download + SHA-256, `--self-test`.
  - UI: React 19 / Tailwind v4 surfaces S1–S5 following the design brief contract, IPC client + mock mode, EN/IT.
  - Verified: vite build, tsc, vitest (27), cargo fmt/clippy/test on Linux (49 + 1 ignored model test),
    Windows cross-build (cargo-xwin) with 50 unit tests and `--self-test` passing on Windows 11.
