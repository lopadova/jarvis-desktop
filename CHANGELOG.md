# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Foundations: product specification, security model (threats T1–T9, rules R1–R12), design brief and ADRs 0001–0005.
- `packages/core`: settings schema, router action schema, offline fast-path intents (EN/IT), risk classification and permission gate, inert deep-link parser, IPC and MCP tool contracts, suggestion-chip catalogue, expressive voice cues, data-dir conventions.
- Relay protocol specification for the ChatGPT relay.
- Documentation: README, `INSTALL_WITH_AI.md`, `llms.txt`, user and developer guides under `docs/`, reference pages (settings, MCP tools, voice commands), and the `docs-site/` documentation site.
- Community files: contributing guide, code of conduct, issue and pull request templates.
- GitHub Actions: CI (lint, typecheck, tests, Rust checks on macOS/Windows/Linux), release (unsigned installers for macOS arm64/x64, Windows x64, Linux x64, plus MCP bundles) and docs deployment to Cloudflare Pages.

## [0.1.0] — planned: "Hello, Jarvis"

### Planned

- Cross-platform tray app on Tauri 2 (macOS, Windows, Linux) with the listening pill, sessions panel, Home screen with suggestion chips, onboarding and settings.
- Brains: Sign in with ChatGPT (Plus/Pro plan), Claude Code, Codex, Anthropic/OpenAI API keys, local models via Ollama or any OpenAI-compatible endpoint.
- Agents: Claude Code (Agent SDK), Codex, built-in Home agent, with safe-by-default, risk-tiered approvals by voice or click.
- Voice out: ElevenLabs, Fish Audio, OpenAI, Kokoro/Piper (local), system voice; streaming with expressive cues.
- Voice in: on-device wake word, voice activity detection and Whisper; push-to-talk; double clap; conversation mode; optional cloud speech-to-text.
- Everyday features: briefing, timers/alarms/reminders, clipboard summarise/translate/fix, dictation, "what's on my screen", file search, web research, shopping list, memory, private mode, usage meter, history.
- Interop: `jarvis-mcp` MCP server, Claude Desktop `.mcpb` extension, Cowork / Claude Code plugin, Cloudflare relay for ChatGPT.
- English and Italian UI.
- Unsigned installers (`.dmg`, `.exe`/`.msi`, `.AppImage`/`.deb`/`.rpm`).

[Unreleased]: https://github.com/lopadova/jarvis-desktop/commits/main
[0.1.0]: https://github.com/lopadova/jarvis-desktop/releases
