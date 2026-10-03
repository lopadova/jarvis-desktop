# Development setup

Everything you need to build and run Jarvis from source on macOS, Windows or Linux.

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| **Node.js** | ≥ 22 | Tooling, tests, UI build |
| **pnpm** | 12 (via Corepack) | Monorepo package manager |
| **Rust** | stable (via [rustup](https://rustup.rs)) | Tauri shell |
| **Bun** | latest | Compiles the TypeScript sidecar into a single binary |
| **Tauri 2 system deps** | see below | Webview, tray, audio |

Enable pnpm through Corepack (the exact version is pinned in the root `package.json`):

```bash
corepack enable
corepack prepare --activate
```

### macOS

```bash
xcode-select --install
```

### Windows

- **Microsoft C++ Build Tools** (Visual Studio Installer › "Desktop development with C++").
- **WebView2** runtime (preinstalled on Windows 11; install it on Windows 10 if missing).

### Linux (Debian/Ubuntu)

```bash
sudo apt-get update
sudo apt-get install -y build-essential curl wget file pkg-config libssl-dev \
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
  libasound2-dev patchelf
```

Other distributions: install the equivalent packages listed in the Tauri 2 prerequisites guide, plus ALSA development headers.

## Clone and run

```bash
git clone https://github.com/lopadova/jarvis-desktop.git
cd jarvis-desktop
pnpm install
pnpm sidecar:build   # compile packages/agent-host with Bun into apps/desktop/src-tauri/binaries/
pnpm dev             # starts the Tauri app in development mode
```

The sidecar binary is named with the Rust target triple (e.g. `agent-host-aarch64-apple-darwin`) so Tauri can bundle it as an `externalBin`. Re-run `pnpm sidecar:build` after changing `packages/agent-host`.

On first run, onboarding opens. For development without a microphone, type in the Home composer.

## Quality checks

Run these before opening a pull request — CI runs the same on Ubuntu, macOS and Windows:

```bash
pnpm lint        # Biome
pnpm typecheck   # TypeScript, all packages
pnpm test        # Vitest (incl. security tests in packages/core/test)
```

Rust (from `apps/desktop/src-tauri`):

```bash
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Docs site (from `docs-site/`):

```bash
npm ci
npm run check    # rejects raw HTML in markdown
npm run build
```

## Repository layout

```text
apps/
  desktop/              Tauri 2 app
    src/                React 19 UI
    src-tauri/          Rust shell (audio, wake word, windows, tray, keyring)
packages/
  core/                 shared types, settings, IPC contract, policy, router schema, suggestions
  agent-host/           TypeScript sidecar (router, agents, memory, MCP server)
  providers/            brains, TTS, cloud STT
  mcp/                  jarvis-mcp server, .mcpb manifest, Cowork / Claude Code plugin
  relay/                remote MCP relay for ChatGPT (Cloudflare Worker)
docs/                   product spec, security model, ADRs, guides, reference
docs-site/              docmd documentation site
resources/              banner and artwork
```

See the [architecture overview](../architecture/overview.md) for how the pieces talk to each other.

## Useful environment variables

| Variable | Use |
|---|---|
| `JARVIS_DATA_DIR` | Use a throwaway data directory while developing (keeps your real memory/history clean). |

## Conventions

- **TypeScript strict**, Biome formatting, no `any`.
- **Security rules are tested.** Changes touching approvals, deep links, routing of untrusted content, secrets or the relay must keep the tests in `packages/core/test` green and add new ones. Read the [security model](../security-model.md) first.
- **Logs:** each package keeps notes in `docs/PROGRESS.md` (what was done, dated) and lessons learned (non-obvious findings, newest first). Add a line when you finish a meaningful piece of work; maintainers consolidate lessons into docs at each milestone.
- Commit messages follow Conventional Commits (`feat(core): …`, `fix(relay): …`, `docs: …`).

## CI, releases and the docs deployment

- `.github/workflows/ci.yml` runs Biome, typecheck and Vitest on Ubuntu, plus `cargo fmt`, `clippy` and `cargo test` on macOS, Windows and Linux.
- `.github/workflows/release.yml` runs on a `v*` tag. It builds the Bun sidecar for each target triple, builds unsigned installers with `tauri-action` and builds the MCP bundles. A single job with write access then creates a **draft** release, adding `SHA256SUMS.txt`. A maintainer publishes it after testing.
- `.github/workflows/docs.yml` builds `docs-site/` on PRs and deploys it to Cloudflare Pages from `main`. It needs the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and optionally the variable `CLOUDFLARE_PAGES_PROJECT`.
  - Create the token with **least privilege**: Account › *Cloudflare Pages* › *Edit*, limited to this one account and, where the dashboard allows it, to this one Pages project.
  - Never use the global API key, and never use a token that also has Workers, DNS or other permissions.
- Every action is **pinned to a full commit SHA**, with the version as a comment. Dependabot (`.github/dependabot.yml`) proposes weekly bumps for actions, npm and cargo.

## Troubleshooting the build

- **`failed to bundle project: sidecar not found`** → run `pnpm sidecar:build` first.
- **Linux: `webkit2gtk-4.1` not found** → install `libwebkit2gtk-4.1-dev` (the 4.0 package is not enough for Tauri 2).
- **Windows: linker errors** → install the C++ Build Tools workload.
