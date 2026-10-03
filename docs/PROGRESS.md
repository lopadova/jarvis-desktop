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
- 2026-10-03 — `packages/agent-host` (sidecar):
  - loopback JSON-RPC server, SQLite store, turn orchestrator, sessions
  - Claude/Codex/Home drivers, approvals, voice output, reminders
  - MCP handler, relay link client
  - 103 vitest tests covering R1–R12
  - Bun-compiled binary verified on Windows
