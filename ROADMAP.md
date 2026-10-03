# Roadmap

## v0.1 — "Hello, Jarvis" (in progress)
See [`docs/PROGRESS.md`](docs/PROGRESS.md) for phase-by-phase status.

- Cross-platform tray app (macOS, Windows, Linux) on Tauri 2
- Brains: Sign in with ChatGPT (Plus/Pro plan), Claude Code, Codex, API keys, local (Ollama)
- Agents: Claude Code, Codex, built-in Home agent, with safe-by-default approvals
- Voice: ElevenLabs, Fish Audio, OpenAI, local Kokoro/Piper; on-device wake word and Whisper
- Everyday features with suggestion chips on the Home screen
- MCP server, Claude Desktop / Cowork extension, ChatGPT relay (Cloudflare free tier)

## Future

### 📱 Mobile companion app
A companion app, not a full mobile Jarvis: iOS does not allow an always-on microphone in the background, and Android restricts it heavily. The companion would offer:
- push-to-talk;
- your live sessions;
- **approving agent permission requests remotely**;
- push notifications when work finishes.

It would pair with the desktop through an end-to-end encrypted **Jarvis Link**, set up with a QR code. The link can travel through the same Cloudflare relay.

Two technical options, to be decided later:
- **Tauri 2 mobile** — reuses the React UI; audio and push need native plugins (Swift/Kotlin).
- **Expo / React Native** — more mature audio and push ecosystem.

Either way, the shared logic lives in `packages/core` (pure TypeScript) and is reused as-is.

### 🔏 Signed & notarised installers
Signing needs an Apple Developer ID (notarisation) and a Windows code-signing certificate, both paid. Until then, releases ship unsigned with clear "how to open" instructions.

### Later ideas
- Speaker verification (only your voice can trigger risky actions)
- Third-party plugin/skill marketplace
- Advanced scheduled routines ("every weekday at 8:30, brief me")
- More languages beyond English and Italian
