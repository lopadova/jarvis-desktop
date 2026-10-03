# ADR 0002 — Sidecar IPC: loopback WebSocket JSON-RPC with a launch token

- Status: Accepted · Date: 2026-10-03

## Decision
Startup and authentication:
- The Rust shell spawns the sidecar and passes it a random 256-bit token through an **environment variable** (never argv).
- The sidecar binds `127.0.0.1:<ephemeral>` and prints the chosen port once on stdout.
- The UI (webview) and Rust connect with the token. Any connection without the token is closed, and the sidecar checks `Origin` to block browser and DNS-rebinding access.
- Messages are **JSON-RPC 2.0**, with schemas defined in `zod` in `packages/core/src/ipc`.

Audio in v0.1:
- Raw microphone PCM does not cross the boundary. Rust runs KWS, VAD and STT, and sends only transcripts.
- TTS audio flows sidecar → Rust as binary frames, for low-latency playback.

## Consequences
- \+ A read-only subset of the same protocol can later be exposed to a mobile companion through the relay.
- − The token check, origin check and loopback-only binding must all be enforced and tested.
