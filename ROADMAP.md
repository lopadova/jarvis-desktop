# Roadmap

## v0.1 — "Hello, Jarvis" (released, unsigned installers)
What shipped is listed below; phase-by-phase history is in [`docs/PROGRESS.md`](docs/PROGRESS.md).

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

### 🎙️ Full-duplex voice conversation
Today's voice is turn-based with barge-in: wake word and VAD run on-device, Whisper transcribes when you stop speaking, the brain answers, and the reply is spoken sentence by sentence (you can interrupt it). Speech-to-speech models (OpenAI Realtime, ElevenLabs conversational agents, Gemini Live) listen and speak at the same time, handle turn-taking and interruptions on the server, and answer in well under a second. Planned in two steps:

1. **Faster turns on the current stack** *(estimate: 3–5 days)* — streaming speech-to-text with partial transcripts, quicker end-of-speech detection, and a streaming cloud STT option.
2. **Optional "Live conversation" mode** *(estimate: 1–2 weeks)* — a realtime speech-to-speech provider used as the voice front-end. It calls Jarvis' tools through the same permission and approval rules (content-is-data, high-risk actions need a click), and hands real work to the Claude/Codex/home agents in the background.

Trade-offs to keep in mind: it needs API keys (ChatGPT plan tokens do not cover audio, so no subscription option), it is billed per audio minute, it sends audio off the computer (so it is disabled in private mode), and the realtime model is the voice, not the coding agent. Both steps are opt-in; the local, private pipeline stays the default.

### Open items after v0.1
Honest list of what was **not** finished or verified in v0.1.x:
- **Wake word by speech recognition** — implemented and unit-tested (matching rules, 58 Rust tests), but not yet verified on the real app with a spoken "Jarvis": Windows Smart App Control blocked the freshly built unsigned executable on the development PC.
- **Echo cancellation** — the setting exists but the feature does not; Jarvis only ignores transcripts that repeat what it just said. Headphones are the fix for now.
- **Local commands wait behind a slow brain turn** — "what time is it" can queue behind a Codex/Claude turn (up to 2 minutes).
- **macOS and Linux installers** are built by CI but have not been run on those systems.
- **Fish Audio / OpenAI voices** were checked only as far as their APIs allow (the Fish test account had no API credit).
- **Signing, updater key and docs hosting** need credentials that belong to the project owner (see below).

### 🔏 Signed & notarised installers
Signing needs an Apple Developer ID (notarisation) and a Windows code-signing certificate, both paid. Until then, releases ship unsigned with clear "how to open" instructions. The release workflow already supports signing: it turns on when the secrets exist (see [Code signing](docs/guides/signing.md)).

### Later ideas
- Speaker verification (only your voice can trigger risky actions)
- Third-party plugin/skill marketplace
- Advanced scheduled routines ("every weekday at 8:30, brief me")
- More languages beyond English and Italian
