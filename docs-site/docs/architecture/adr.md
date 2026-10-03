---
title: "Architecture decisions"
description: "The architecture decision records behind Jarvis: stack, sidecar IPC, permission model, Sign in with ChatGPT and the ChatGPT relay."
---

# Architecture decisions (ADR)

Each decision is recorded in `docs/adr` in the repository. Summaries:

::: collapsible "ADR 0001 — Tauri 2 shell + TypeScript sidecar"
**Context.** Jarvis runs all day on three operating systems with an always-on wake word, so footprint
matters; the best AI SDKs (Claude Agent SDK, Codex SDK, MCP SDK) are TypeScript-first.

**Options.** Electron (one language, but 150–300 MB RAM and large installers); Tauri 2 Rust-only
(smallest, but no first-party SDKs); Tauri 2 shell + TypeScript sidecar.

**Decision.** Tauri 2 + a Bun-compiled TypeScript sidecar. Rust owns windows, tray, shortcuts, keyring,
audio, wake word/VAD/Whisper and sidecar supervision; the sidecar owns router, providers, agents,
memory, policy and MCP. UI in React 19 + Vite, sharing types via `packages/core`.

**Consequences.** Small installers and ~50–80 MB resident memory; official SDKs; reusable core for a
future mobile companion. Two runtimes to package (one sidecar binary per target triple) and an IPC
boundary to design and test.
:::

::: collapsible "ADR 0002 — Sidecar IPC: loopback WebSocket JSON-RPC with a launch token"
**Decision.** The shell passes a random 256-bit token to the sidecar via an environment variable (never
argv). The sidecar binds `127.0.0.1` on an ephemeral port and prints it once. UI and shell connect with
the token; connections without it are closed, and `Origin` is checked against browsers and DNS
rebinding. Messages are JSON-RPC 2.0 with zod schemas in `packages/core`.

**Audio.** Raw PCM never crosses the boundary: Rust runs wake word, VAD and STT and sends transcripts.
TTS audio flows sidecar → Rust as binary frames.

**Consequences.** A read-only subset can later serve a mobile companion through the relay; token,
origin and loopback checks must be enforced and tested.
:::

::: collapsible "ADR 0003 — Safe-by-default permission levels and risk-tiered approvals"
**Context.** A voice-activated assistant that runs shell commands faces voice injection from the room
and prompt injection from content; headless agents either bypass permissions or get stuck.

**Decision.** Agents ask Jarvis — Claude via `canUseTool`, Codex via app-server approvals, the Home
agent via its tool gate. Jarvis classifies low / medium / high risk; voice approval for low/medium, a
click for high. Project levels: Safe (default), Trusted (allowlist), Full auto (explicit opt-in).

**Consequences.** Real safety without useless agents; the approval history doubles as an audit log;
some friction, reduced by "always allow in this project" for low/medium risk.
:::

::: collapsible "ADR 0004 — Sign in with ChatGPT as a first-class brain"
**Context.** Sign in with ChatGPT lets Plus and Pro users let third-party apps spend their plan
allowance, with a weekly cap per app set by the user; open-source local apps can register themselves.

**Decision.** Authorization Code + PKCE + OIDC nonce in the system browser with a loopback redirect;
dynamic registration on first sign-in; ID token validated against JWKS; inference only through the
Responses API with `store: false` and streaming; tokens in the OS keyring, refreshed proactively. On
`subscription_sharing_usage_limit_exceeded`, Jarvis shows the cap and never falls back to a paid API.

**Consequences.** Plan tokens do not cover audio, so voice always uses separate providers. Open
question tracked during implementation: tool calling / structured outputs with plan tokens (fallback:
strict JSON-in-text validated with zod, one repair retry).
:::

::: collapsible "ADR 0005 — Remote MCP relay for ChatGPT on Cloudflare Workers"
**Context.** ChatGPT only connects to remote HTTPS MCP servers; Jarvis runs behind NAT and must not
open inbound ports.

**Decision.** `packages/relay`: a Cloudflare Worker with one Durable Object per paired desktop. The
desktop keeps an outbound WebSocket (hibernation keeps it in the free tier); ChatGPT calls `/mcp` over
Streamable HTTP; the Worker authenticates with OAuth and forwards calls over the socket. Pairing via QR
or short code (hash stored only); tool exposure filtered on the desktop and read-only by default; every
call visible; "Deploy to Cloudflare" button plus `wrangler deploy`.

**Alternatives documented.** Vercel (long-polling via Upstash Redis, higher latency); Cloudflare Tunnel
(no code, exposes the local MCP HTTP endpoint; auth must be enabled).

**Consequences.** No inbound ports, free hosting, works behind NAT; one more deployable; ChatGPT plan
limits on write tools must be documented honestly.
:::

::: callout info "Proposing a new decision" icon:file-plus
Significant changes (new runtime, new IPC, security-relevant behaviour) need an ADR. Copy the format
of an existing one in `docs/adr`, open a pull request, and link it from the related code.
:::
