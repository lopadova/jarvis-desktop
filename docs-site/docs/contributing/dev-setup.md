---
title: "Development setup"
description: "Build and run Jarvis from source on macOS, Windows or Linux: prerequisites, monorepo layout, commands, tests and the docs site."
---

# Development setup

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 22 or newer | Workspace tooling, UI build |
| pnpm | 12 (see `packageManager` in `package.json`) | Monorepo package manager |
| Rust | stable, with `cargo` | Tauri shell |
| Bun | latest | Compiles the TypeScript sidecar into a single binary |
| Tauri prerequisites | per OS | Webview and build tools |

::: tabs
== tab "macOS"
```bash
xcode-select --install
```

== tab "Windows"
Install **Microsoft C++ Build Tools** (Desktop development with C++) and make sure **WebView2** is
present (it ships with Windows 11).

== tab "Linux (Debian/Ubuntu)"
```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
  libasound2-dev patchelf build-essential curl wget file libssl-dev libxdo-dev
```
:::

## Get the code and run

::: steps
1. **Clone and install**
   ```bash
   git clone https://github.com/lopadova/jarvis-desktop.git
   cd jarvis-desktop
   pnpm install
   ```
2. **Build the sidecar for your platform**
   ```bash
   pnpm sidecar:build
   ```
   The Bun-compiled binary lands in `apps/desktop/src-tauri/binaries/` with your target-triple suffix,
   where Tauri's `externalBin` expects it.
3. **Start the app in dev mode**
   ```bash
   pnpm dev
   ```
:::

## Monorepo layout

```text
apps/desktop/            Tauri 2 shell (src-tauri, Rust) + React 19 UI (src)
packages/core/           pure TypeScript: schemas, IPC contract, router, policy, suggestions
packages/agent-host/     TypeScript sidecar: router, agents, memory, MCP server
packages/providers/      brains, TTS, cloud STT
packages/mcp/            jarvis-mcp.mjs stdio bridge, .mcpb manifest, Cowork / Claude Code plugin
packages/relay/          Cloudflare Worker relay for ChatGPT (+ Vercel variant)
docs/                    product spec, security model, ADRs, guides
docs-site/               this documentation site (docmd)
scripts/                 e2e smoke tests, Windows cross-build and Sandbox runner, signing helpers
```

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm dev` | Run the desktop app in development |
| `pnpm test` | Vitest across the workspace |
| `pnpm typecheck` | TypeScript checks for every package |
| `pnpm lint` | Biome lint + format check |
| `pnpm format` | Biome format, write |
| `pnpm build` | Build all packages |
| `pnpm sidecar:build` | Compile the sidecar binary |
| `pnpm e2e` | Build the MCP bridge, then run the sidecar + MCP bridge smoke test (needs Bun) |
| `pnpm e2e:relay` | Real sidecar against a local `wrangler dev` relay: pairing, OAuth, tools, unpair |
| `pnpm --filter @jarvis/relay test` | Relay unit tests (they run in workerd, so they are not part of `pnpm test`) |
| `cargo fmt --check`, `cargo clippy`, `cargo test` | Rust checks (in `apps/desktop/src-tauri`) |

## Data directory and self-test

Set `JARVIS_DATA_DIR` to use a throwaway data directory. By default it is `~/Library/Application Support/Jarvis`
(macOS), `%APPDATA%\Jarvis` (Windows) or `~/.local/share/jarvis` (Linux, honouring `XDG_DATA_HOME`).
`jarvis-desktop --self-test` initialises the native subsystems without opening a window and exits 0 when
the essentials work.

## Tests that matter

- **Security tests** in `packages/core/test` cover the rules of the [security model](/security/model):
  inert deep links, injected content never producing actions, approval required in Safe, shell risk
  classification. A change that weakens a rule must update the model and the tests together.
- Router and fast-path tests, voice cue mapping, provider fixtures.

## Working on the docs site

```bash
cd docs-site
npm ci
npm run dev      # live preview
npm run check    # rejects raw HTML in markdown
npm run build    # static site + semantic search index
```

Use docmd containers (callouts, cards, steps, tabs, collapsibles) instead of HTML. The docs build runs
`npm ci`, so keep `package.json` and `package-lock.json` in sync.
