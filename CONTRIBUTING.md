# Contributing to Jarvis

Thanks for helping! Jarvis is a voice assistant that can run agents on people's computers, so we care about two things above all: **it must be safe**, and **it must be easy for non-technical people**. Every kind of contribution helps — code, docs, translations, design feedback, and testing on your OS and microphone.

By participating you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a bug** — use the [bug report form](https://github.com/lopadova/jarvis-desktop/issues/new?template=bug_report.yml). Include your OS, Jarvis version, brain and voice provider.
- **Suggest a feature** — use the [feature request form](https://github.com/lopadova/jarvis-desktop/issues/new?template=feature_request.yml). Tell us the everyday situation, not only the solution.
- **Security issues** — **never** in a public issue. See [SECURITY.md](SECURITY.md).
- **Improve docs** — the `docs/` guides and the `docs-site/` are plain Markdown.
- **Translate** — UI strings live in English and Italian; new languages are welcome (see the [Roadmap](ROADMAP.md)).
- **Pick an issue** — look for `good first issue` and `help wanted` labels.

## Development setup

See [docs/contributing/dev-setup.md](docs/contributing/dev-setup.md) for prerequisites (Node.js ≥ 22, pnpm, Rust, Bun, Tauri 2 system packages). In short:

```bash
corepack enable
pnpm install
pnpm sidecar:build
pnpm dev
```

## Repository layout

| Path | What |
|---|---|
| `apps/desktop` | Tauri 2 app: Rust shell (`src-tauri`) and React 19 UI (`src`) |
| `packages/core` | Pure TypeScript domain: models, router schema, fast path, security policy, IPC and MCP contracts |
| `packages/agent-host` | Bun-compiled sidecar: RPC server, sessions, agents, approvals, voice pipeline |
| `packages/providers` | Brains, text-to-speech and cloud speech-to-text providers |
| `packages/mcp` | `jarvis-mcp` bridge, Claude Desktop `.mcpb`, Cowork / Claude Code plugin |
| `packages/relay` | Remote MCP relay for ChatGPT (Cloudflare Worker) |
| `docs/`, `docs-site/` | Guides, ADRs, the docmd documentation site |

## Golden rules

1. **Security model first.** Read [docs/security-model.md](docs/security-model.md). Rules R1–R12 each have automated tests; never weaken one without an ADR in `docs/adr/`.
2. **Contracts live in `packages/core`.** Change them deliberately and update every consumer and test.
3. **No secrets outside the OS keyring.** No prompts or user content in command-line arguments. No string-built shell, AppleScript or PowerShell.
4. **Never silently fall back to a paid API** when a subscription cap is reached.
5. **English** for code, comments and docs. Every UI string in both `en` and `it`.
6. Use the latest stable library versions and check APIs against official docs.

## Pull requests

1. Fork and create a branch from `main` (`feat/…`, `fix/…`, `docs/…`).
2. Keep PRs small and focused; one concern per PR.
3. Use [Conventional Commits](https://www.conventionalcommits.org) (`feat(core): …`, `fix(desktop): …`, `docs: …`).
4. Before pushing, run:

   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   # if you touched Rust:
   cd apps/desktop/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
   # if you touched docs-site:
   cd docs-site && npm ci && npm run check && npm run build
   ```

5. Fill in the PR template. Tick the security checklist honestly — "not applicable" is a fine answer.
6. Update docs when behaviour changes, add a line to [`docs/PROGRESS.md`](docs/PROGRESS.md), and record non-obvious findings in [`docs/LESSON.md`](docs/LESSON.md).

### Definition of done

- Tests for new behaviour (and a security test if you touch approvals, deep links, routing of untrusted content, secrets, processes or the relay).
- Lint, typecheck and clippy clean; CI green on macOS, Windows and Linux.
- English and Italian strings for any UI change.
- Docs updated.

## Docs site

The documentation site under `docs-site/` uses [docmd](https://www.npmjs.com/package/@docmd/core). **Raw HTML is not allowed** in its Markdown — use docmd `:::` containers (callouts, cards, steps, tabs). `npm run check` enforces this. Keep `package.json` and `package-lock.json` in sync (`npm install`, then commit the lock file), because Cloudflare Pages runs `npm ci`.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
