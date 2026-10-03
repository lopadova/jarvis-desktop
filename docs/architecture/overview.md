# Architecture overview

Jarvis is a **Tauri 2 shell** (Rust) with a **React 19** UI and a **TypeScript sidecar** (`agent-host`, compiled to a single binary with Bun). Rust does what must be native and fast — audio, wake word, windows, keyring. TypeScript does the product logic with the official AI SDKs. Why: [ADR 0001](../adr/0001-stack-tauri2-typescript.md).

## Big picture

```mermaid
flowchart LR
  subgraph Desktop["Your computer"]
    direction LR
    subgraph Shell["Tauri 2 shell (Rust)"]
      A["Audio I/O<br/>wake word · VAD · Whisper<br/>echo cancellation"]
      W["Windows · tray · shortcuts<br/>keyring · notifications"]
    end
    UI["React UI<br/>pill · sessions · home · settings"]
    subgraph Sidecar["agent-host sidecar (TypeScript, Bun)"]
      R["Router + fast path<br/>policy · memory"]
      AG["Agent drivers"]
      MCPS["MCP server"]
    end
    BR["jarvis-mcp.mjs<br/>(stdio bridge)"]
    DB[("SQLite<br/>jarvis.db")]
  end

  Shell <-- "loopback WebSocket<br/>JSON-RPC 2.0 + launch token" --> Sidecar
  UI <-- "loopback WebSocket<br/>JSON-RPC 2.0 + launch token" --> Sidecar
  Sidecar --- DB

  R --> P["Brains<br/>ChatGPT plan · Claude Code · Codex<br/>API keys · Ollama"]
  R --> T["Voices<br/>ElevenLabs · Fish · OpenAI<br/>Kokoro · Piper · system"]
  AG --> C1["Claude Agent SDK"]
  AG --> C2["Codex app-server<br/>(SDK fallback)"]
  AG --> C3["Home agent<br/>+ your MCP servers"]

  CD["Claude Desktop · Cowork<br/>Claude Code · Codex"] -- stdio --> BR
  BR -- "mcp token" --> MCPS
  Sidecar -- "outbound WebSocket" --> RL["Relay<br/>Cloudflare Worker + Durable Object"]
  CG["ChatGPT"] -- "HTTPS MCP + OAuth" --> RL
```

## Processes and boundaries

| Process | Language | Owns |
|---|---|---|
| **Shell** (`apps/desktop/src-tauri`) | Rust | Windows (frameless, glass/solid), tray, global shortcuts with press/release, keyring, audio capture/playback, wake word + VAD (sherpa-onnx), Whisper (whisper.cpp), echo cancellation, clap detection, single instance, autostart, deep links (the updater plugin is present but auto-update is off in v0.1), sidecar supervision |
| **UI** (`apps/desktop/src`) | React 19 + TS | Presentational surfaces: listening pill, sessions panel, home, onboarding, settings |
| **Sidecar** (`packages/agent-host`) | TypeScript (Bun binary) | Router, fast path, providers, agent drivers, approvals, memory, history, reminders, MCP server, relay link |
| **MCP bridge** (`jarvis-mcp.mjs`) | TypeScript | Stdio MCP server launched by Claude/Codex; forwards to the sidecar |
| **Relay** (`packages/relay`) | TypeScript (Worker) | Remote HTTPS MCP endpoint for ChatGPT; forwards through the desktop's outbound socket |

### IPC (ADR 0002)

- The shell spawns the sidecar with a random 256-bit token in the `JARVIS_LAUNCH_TOKEN` **environment variable** (never argv).
- The sidecar binds `127.0.0.1:<ephemeral>`, prints `JARVIS_READY <port>` once, and accepts only connections presenting the token, with an `Origin` check against browsers and DNS rebinding.
- Messages are JSON-RPC 2.0 with zod schemas in `packages/core/src/ipc.ts`. Roles: `ui` (calls `app.*`, receives `ui.*`), `shell` (sends `voice.*`, serves `host.*`), `mcp` (calls `mcp.call`).
- Raw microphone audio stays in Rust; only transcripts cross the boundary (plus captured command audio when a cloud STT is enabled). TTS audio flows sidecar → shell as binary frames.
- Local MCP bridges find the sidecar through `run/agent-host.json` (owner-only), whose token authorises **only** the `mcp` role.

Details: [ADR 0002](../adr/0002-sidecar-ipc.md).

## A turn, end to end

```mermaid
sequenceDiagram
  autonumber
  actor U as You
  participant S as Shell (Rust)
  participant H as agent-host
  participant B as Brain
  participant A as Agent
  U->>S: "Jarvis, in project shop add a footer"
  S->>S: wake word → VAD (≈1.2 s silence) → Whisper
  S->>H: voice.transcript
  H->>H: fast path? (timers, stop, status… no LLM)
  H->>B: utterance + context (projects, sessions as untrusted data, memory)
  B-->>H: RouterAction (validated with zod)
  H->>H: policy check (grounded in utterance?)
  H->>A: spawn session (project shop, agent claude)
  H-->>S: speak "On it, working on shop." (streamed TTS)
  A->>H: permission request (e.g. run pnpm build)
  H->>H: classify risk → gate(level, risk)
  H-->>U: approval card (voice OK for low/medium, click for high)
  U->>H: "yes"
  A-->>H: result
  H-->>S: spoken summary (≤ 25 words) + notification
```

The router's output contract (`RouterAction`: `answer`, `spawn`, `followup`, `cancel`, `status`, `open`, `clarify`, `create_project`, `reminder`, plus `remember` / `forget`) is defined in the [product spec](../product-spec.md#5-routeraction-schema-contract).

## Packages

| Path | Purpose |
|---|---|
| `apps/desktop` | Tauri 2 app: Rust shell (`src-tauri`) and React UI (`src`) |
| `packages/core` | Shared pure TypeScript: settings, IPC contract, `McpTools`, router schema and prompt, fast path, risk policy, suggestions, phrases, voice cues, paths. Reusable by a future mobile companion. |
| `packages/agent-host` | The sidecar: router, memory, policy, agent drivers, MCP server |
| `packages/providers` | Brains, TTS and cloud STT implementations |
| `packages/mcp` | `jarvis-mcp.mjs` stdio/HTTP server, `.mcpb` manifest, Cowork / Claude Code plugin |
| `packages/relay` | Remote MCP relay for ChatGPT (Cloudflare Worker + Durable Object; Vercel variant) |
| `docs/`, `docs-site/` | Markdown docs and the docmd documentation site |

## Security architecture

Safe-by-default permission levels, risk-tiered approvals, inert deep links, "content is data", keyring-only secrets, process-group supervision and relay hardening are specified in the [security model](../security-model.md) (rules R1–R12, each with an automated test) and [ADR 0003](../adr/0003-permission-model.md).

## Decisions

- [ADR 0001 — Tauri 2 shell + TypeScript sidecar](../adr/0001-stack-tauri2-typescript.md)
- [ADR 0002 — Sidecar IPC](../adr/0002-sidecar-ipc.md)
- [ADR 0003 — Permission model](../adr/0003-permission-model.md)
- [ADR 0004 — Sign in with ChatGPT](../adr/0004-sign-in-with-chatgpt.md)
- [ADR 0005 — ChatGPT relay](../adr/0005-chatgpt-relay.md)
- [Relay protocol](relay-protocol.md)
