# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-10-03 — "Hello, Jarvis"

First public release. Installers are **unsigned** (see `docs/guides/signing.md`).

### Added
- **Cross-platform app (Tauri 2)** for macOS, Windows and Linux: tray, listening pill, sessions panel, chat-style Home with suggestion chips, onboarding and settings — pixel-perfect from the Claude Design handoff, dark/light × glass/solid, English and Italian.
- **Brains:** Sign in with ChatGPT (Plus/Pro plan tokens, open-source token-sharing flow, never a silent paid fallback), Claude Code, Codex, Anthropic/OpenAI API keys, local models (Ollama / OpenAI-compatible); vision for "what's on my screen".
- **Agents:** Claude Code (Agent SDK, `canUseTool` approvals), Codex (`codex app-server` approvals, sandbox fallback), built-in Home agent with egress guard; safe-by-default, risk-tiered approvals by voice or click.
- **Voice out:** ElevenLabs (v3 tags / flash), Fish Audio, OpenAI, Piper, Kokoro, system voice; neutral expressive cues; streaming replies with barge-in.
- **Voice in:** on-device wake word, Silero VAD and Whisper (sherpa-onnx), push-to-talk with release, double clap, conversation mode, optional cloud STT (OpenAI, ElevenLabs Scribe).
- **Everyday features:** morning briefing, timers/alarms/reminders, dictation, clipboard summarise/translate/fix, screen explain (opt-in), shopping list, memory you can see and edit, forget today, private/local mode, usage meter.
- **Interop:** `jarvis-mcp` stdio/HTTP MCP bridge, Claude Desktop `.mcpb` extension, Claude Code / Cowork plugin, Codex config; remote MCP relay for ChatGPT on Cloudflare Workers (free tier) with OAuth + pairing code, Vercel long-poll variant, Cloudflare Tunnel guide.
- **Security:** threat model and rules R1–R12 with regression tests (inert deep links, content-is-data, grounding, risk gate hardening, keyring-only secrets, process-tree safety, relay grant revocation, SSRF/egress guard, strict terminal allowlist).
- **Tooling:** Windows cross-build in Docker (offline SDK mode) and Windows Sandbox test harness; opt-in code signing (Azure Trusted Signing, Apple notarisation); docs-site (docmd) with semantic search; SHA-pinned GitHub Actions.

### Known limitations
- No auto-update in v0.1.0 (the updater key is a placeholder): install the newer installer over the old one.
- The desktop relay client speaks WebSocket only, so the Vercel long-poll relay variant cannot be paired yet (Cloudflare Workers or a Tunnel work).
- Settings › Integrations: the "Install extension" button is disabled; install `jarvis.mcpb` from the release page.
- Unsigned builds: Windows SmartScreen / Smart App Control and macOS Gatekeeper warn or block until you allow them.
- Acoustic echo cancellation is a stub; Focus/Do-Not-Disturb detection is Windows-only.
- Sign in with ChatGPT is verified against a mock server; verify on your account and report issues.
- Mobile companion, speaker verification and scheduled routines are on the [roadmap](ROADMAP.md).

[Unreleased]: https://github.com/lopadova/jarvis-desktop/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/lopadova/jarvis-desktop/releases/tag/v0.1.0
