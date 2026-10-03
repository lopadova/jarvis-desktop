# Progress

| Phase | Scope | Status |
|---|---|---|
| 0 | Foundations: design brief, product spec, security model, ADRs | ✅ in review |
| 1 | Scaffold: monorepo, Tauri 2 shell, sidecar, CI | ⏳ next |
| 1b | **UI pixel-perfect** from the Claude Design handoff in `docs/design/handoff/` (replaces the provisional UI) | ⏳ after desktop shell lands |
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
- 2026-10-03 — Docs & community (branch `feat/docs`):
  - `README.md` (WOW: banner, badges, everyday features first, moats, comparison, quickstarts a–h, examples, architecture, security, FAQ), `resources/jarvis-banner.svg`
  - `INSTALL_WITH_AI.md` (guide for AI assistants helping non-technical users) and `llms.txt`
  - `docs/guides/*` (13 guides), `docs/reference/{settings,mcp-tools,voice-commands}.md`, `docs/architecture/overview.md`, `docs/contributing/dev-setup.md`
  - `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, issue/PR templates, `FUNDING.yml`, `dependabot.yml`
  - Workflows: `ci.yml`, `release.yml` (draft release, unsigned installers, `.mcpb`, checksums), `docs.yml` (Cloudflare Pages), all actions SHA-pinned
  - `docs-site/` docmd site (WOW landing, 28 pages, semantic search, raw-HTML guard)
- 2026-10-03 — Claude Design handoff received and versioned in `docs/design/handoff/` (main: `Jarvis Desktop.dc.html` + component prototypes). To be implemented pixel-perfect in `apps/desktop/src` as phase 1b.
