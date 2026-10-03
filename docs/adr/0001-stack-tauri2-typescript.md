# ADR 0001 — Tauri 2 shell + TypeScript sidecar

- Status: Accepted · Date: 2026-10-03

## Context
Jarvis must run on macOS, Windows and Linux. It stays resident all day as a tray app with an always-on wake word, so footprint matters. It also needs to integrate with AI SDKs that are TypeScript-first: Claude Agent SDK, Codex SDK and the MCP SDK.

## Options
1. **Electron** — one language and a mature ecosystem. Costs 150–300 MB of resident RAM and ~150 MB installers, and capturing global key-release events needs native hooks.
2. **Tauri 2, Rust only** — the smallest footprint. There are no first-party TS SDKs, so agent drivers would have to be re-implemented by parsing CLI output.
3. **Tauri 2 shell + TypeScript sidecar** — thin Rust for OS and audio work; all product logic in TS using the official SDKs.

## Decision
Option 3.

- **Rust owns:** windows, tray, global shortcuts (press/release), keyring, audio I/O, wake word/VAD/whisper, and supervision of the sidecar process.
- **A Bun-compiled TypeScript sidecar** (`packages/agent-host`) owns: router, providers, agents, memory, policy and the MCP server.
- **UI:** React 19 + Vite. The UI and the sidecar share types from `packages/core`.

## Consequences
- \+ ~10–15 MB installers and ~50–80 MB resident memory.
- \+ We use the official SDKs.
- \+ `packages/core` is reusable by a future mobile companion.
- − Two runtimes to package: one sidecar binary per target triple, shipped via Tauri `externalBin`.
- − An IPC boundary to design and test (see ADR 0002).
