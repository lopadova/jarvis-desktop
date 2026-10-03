## What and why

<!-- What does this PR change, and why? Link the issue: "Closes #123". -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / chore
- [ ] Docs
- [ ] Breaking change (contracts in `packages/core`, settings, IPC, MCP tools, relay protocol)

## How was it tested?

<!-- Commands you ran, OSes you tried, manual checks (wake word, approvals, relay…). -->

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] Rust: `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test` (if Rust changed)
- [ ] Docs site: `npm ci && npm run check && npm run build` in `docs-site/` (if docs-site changed)
- [ ] Manually tested on: <!-- macOS / Windows / Linux -->

## Security checklist

See [docs/security-model.md](../docs/security-model.md). Tick or write "n/a".

- [ ] No new way to trigger actions without the user's own utterance or click (voice from the room, deep links, injected content, relay).
- [ ] Approvals: high-risk actions still need a click; no new "always allow" for high risk.
- [ ] Untrusted content (results, web, email, tool output) stays inside `<untrusted_data>` and cannot create actions.
- [ ] No secrets outside the OS keyring; nothing sensitive in argv or logs.
- [ ] No string-built shell / AppleScript / PowerShell.
- [ ] No automatic fallback to a paid API.
- [ ] Security tests added or updated where relevant.

## Docs and housekeeping

- [ ] UI strings added in both English and Italian.
- [ ] Docs updated (`docs/`, `docs-site/`, README) if behaviour changed.
- [ ] Line added to `docs/PROGRESS.md`; non-obvious findings in `docs/LESSON.md`.
- [ ] Conventional Commit messages.
