# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] — 2026-10-04

### Added
- **Wake word by speech recognition** (`wakeByRecognition`, on by default): short phrases heard while idle are transcribed on-device and matched against "Jarvis", "Giarvis", "Hey Jarvis" …; works with Italian accents the keyword spotter misses. "Jarvis, che ore sono?" runs the command at once.
- **Settings › Voice:** provider status (*Ready* / *Needs setup*), voice list, ElevenLabs model, stability, similarity, style and speaker boost.
- **Memory:** add facts from the app. **Projects:** add and remove projects. **History** points to Settings › Privacy › Danger zone.
- End-to-end test harness that drives the real app (`scripts/e2e-app`), diagnostics for wake-word tuning (opt-in).

### Fixed
- Microphone did nothing when the selected Whisper size was not installed; the model list now refreshes and falls back to an installed model, or says none is installed.
- Cloud voices that cannot speak (no key, no credit, errors) now tell you and use the system voice; HTTP 402 is reported as "no credit left".
- Whisper silence tags (`[BLANK_AUDIO]`) and transcripts that repeat Jarvis' own voice no longer become requests.
- About links and **Install extension** now open the browser (allow-listed project pages only).

### Known limitations
- Acoustic echo cancellation is not available yet (headphones recommended on speakers).
- The wake word by speech recognition was not yet verified on the real app (see ROADMAP.md › Open items).

## [0.1.1] — 2026-10-04

### Fixed
- Settings and Sessions windows were blank on Windows (window creation thread); the QR code library no longer blanks Settings.
- **Sign in with ChatGPT** could not save its token in Windows Credential Manager (2560-unit limit): secrets are now stored in chunks.
- `JARVIS_SIDECAR_REPO` runs the assistant process from source when Smart App Control blocks the bundled binary.
- Installers for macOS, Windows and Linux are attached to the release.

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
