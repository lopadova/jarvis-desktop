# AGENTS.md — working on Jarvis Desktop

Instructions for AI coding agents (and humans) contributing to this repository.

## Layout
| Path | What | Stack |
|---|---|---|
| `apps/desktop` | Tauri 2 app: Rust shell (`src-tauri`) + React 19 UI (`src`) | Rust, TS, Vite, Tailwind v4 |
| `packages/core` | Pure domain: models, router schema/prompts, fast path, security policy, IPC + MCP contracts | TS (no I/O) |
| `packages/agent-host` | Sidecar (Bun-compiled): RPC server, orchestrator, sessions, agents, approvals, voice pipeline | TS |
| `packages/providers` | Brains (ChatGPT plan, Claude Code, Codex, APIs, local), TTS, cloud STT | TS |
| `packages/mcp` | `jarvis-mcp` stdio/HTTP MCP bridge, Claude Desktop `.mcpb`, Claude Code/Cowork plugin | TS |
| `packages/relay` | Remote MCP relay for ChatGPT (Cloudflare Worker; Vercel variant) | TS |
| `docs/`, `docs-site/` | Markdown docs, ADRs, docmd site | Markdown |

## Golden rules
1. **Security model first.** Read `docs/security-model.md`. Every rule (R1–R12) has tests; never weaken one without an ADR. Shell risk lives in `packages/core/src/policy/risk.ts`.
2. **Contracts live in `packages/core`.** Change them deliberately; update every consumer and the tests.
3. **No secrets outside the OS keyring.** No prompts or user content in argv. No string-built shell/AppleScript/PowerShell.
4. **Never silently fall back to a paid API** when a subscription cap is reached.
5. **English** for code, comments and docs. UI strings in both `en` and `it`.
6. Latest stable library versions; check APIs against official docs.

## Commands
```bash
pnpm install
pnpm test            # vitest across workspaces
pnpm typecheck
pnpm lint            # biome
pnpm dev             # tauri dev (needs Rust + Bun)
cd apps/desktop/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

## Workflow
- One branch per macro-task, small PRs, Conventional Commits.
- Definition of done: tests for new behaviour, lint/typecheck/clippy clean, docs updated, an entry in `docs/PROGRESS.md`, and non-obvious findings in `docs/LESSON.md`.
