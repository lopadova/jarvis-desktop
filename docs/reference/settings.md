# Settings reference

Every user setting, as defined by `SettingsSchema` in [`packages/core/src/settings.ts`](../../packages/core/src/settings.ts). Settings are validated with zod: unknown keys are dropped and missing keys take their defaults, so settings files stay forward- and backward-compatible.

Most settings are editable in the Settings window; the tab is shown in brackets. **Secrets (API keys, tokens) are never settings** — they live in the OS keyring.

## General and appearance

| Key | Type | Default | Meaning |
|---|---|---|---|
| `locale` | `'en' \| 'it'` | `'en'` | Interface and voice language. [General] |
| `userName` | string (≤ 80) | `''` | How Jarvis greets you ("Good morning, Lorenzo"). [General] |
| `onboardingComplete` | boolean | `false` | Set when the 5-step setup is finished. |
| `launchAtLogin` | boolean | `false` | Start Jarvis when you log in. [General] |
| `theme` | `'system' \| 'dark' \| 'light'` | `'system'` | Colour theme. [General] |
| `material` | `'auto' \| 'glass' \| 'solid'` | `'auto'` | Translucent (glass) or opaque (solid) windows. `auto` uses glass where the OS supports it (macOS, Windows 11) and solid elsewhere. [General] |
| `accentHue` | number 0–360 | `200` | Accent colour hue. [General] |

## Brain and agents

| Key | Type | Default | Meaning |
|---|---|---|---|
| `primaryBrain` | `'chatgpt' \| 'claude' \| 'codex' \| 'api-anthropic' \| 'api-openai' \| 'local' \| null` | `null` | The brain used to understand requests. `null` until you connect one. [Brain & accounts] |
| `localBrain` | `{ baseUrl, model }` | `{ baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.2' }` | OpenAI-compatible local endpoint (Ollama by default). [Brain & accounts] |
| `apiModels` | `{ anthropic, openai }` | `{ anthropic: 'claude-haiku-4-5', openai: 'gpt-5-mini' }` | Models used with API keys. [Brain & accounts] |
| `chatgptModel` | string | `''` | Model for Sign in with ChatGPT; empty = account default. [Brain & accounts] |
| `codingModel` | string | `'claude-opus-5-5'` | Stronger model used for coding tasks. [Agents & projects] |
| `defaultAgent` | `'claude' \| 'codex' \| 'home'` | `'claude'` | Agent used when a project or request doesn't specify one. [Agents & projects] |
| `maxConcurrentSessions` | integer 1–12 | `4` | Maximum background sessions running at once. [Agents & projects] |
| `generalWorkspace` | path | `''` | Folder for non-project work; empty = a default inside the data directory. [Agents & projects] |
| `projectsRoot` | path | `'~/Projects'` | Where new projects are created by default. [Agents & projects] |
| `claudePath` | path | `''` | Path to the Claude Code CLI; empty = auto-detect on `PATH`. [Agents & projects] |
| `codexPath` | path | `''` | Path to the Codex CLI; empty = auto-detect on `PATH`. [Agents & projects] |

## Voice out (text-to-speech)

| Key | Type | Default | Meaning |
|---|---|---|---|
| `tts` | `'elevenlabs' \| 'fish' \| 'openai' \| 'kokoro' \| 'piper' \| 'system'` | `'system'` | Voice provider. See [Voices](../guides/voices.md). [Voice] |
| `ttsVoice` | record `locale → voiceId` | `{}` | Chosen voice per language; empty = provider default. [Voice] |
| `elevenlabsModel` | `'eleven_v3' \| 'eleven_flash_v2_5' \| 'eleven_multilingual_v2'` | `'eleven_v3'` | ElevenLabs model: expressive v3 (HTTP streaming) or low-latency Flash (WebSocket). [Voice] |
| `fishModel` | string | `'s2-pro'` | Fish Audio model. [Voice] |
| `speakingRate` | number 0.5–2 | `1` | Speech speed. [Voice] |
| `speakReplies` | boolean | `true` | Speak replies out loud. [Voice] |
| `speakProgress` | boolean | `true` | Spoken progress updates for background sessions. [Voice] |
| `speakSummaries` | boolean | `true` | Short spoken summary when a session finishes. [Voice] |
| `muteDuringFocus` | boolean | `true` | Stay quiet during OS Focus / Do Not Disturb. [Voice] |

## Voice in (microphone and transcription)

| Key | Type | Default | Meaning |
|---|---|---|---|
| `stt` | `'local-whisper' \| 'openai' \| 'elevenlabs'` | `'local-whisper'` | Transcription provider. Cloud options are opt-in. [Microphone & wake word] |
| `whisperModel` | `'tiny' \| 'base' \| 'small' \| 'medium' \| 'large-v3-turbo'` | `'small'` | Local Whisper model size. [Microphone & wake word] |
| `wakeWord` | boolean | `true` | Listen for "Jarvis" (on-device). [Microphone & wake word] |
| `wakeOnClap` | boolean | `false` | Double clap starts listening (only while idle). [Microphone & wake word] |
| `conversationMode` | boolean | `true` | Keep listening briefly after a reply, without the wake word. [Microphone & wake word] |
| `conversationWindowMs` | integer 2000–20000 | `6000` | How long conversation mode listens, in ms. [Microphone & wake word] |
| `echoCancellation` | boolean | `true` | Prevent Jarvis from hearing its own voice. [Microphone & wake word] |
| `pushToTalk` | hotkey string | `'Alt+Space'` | Hold to talk (`⌥ Space` on macOS). On Windows we suggest `Ctrl+Alt+Space`. [Shortcuts] |
| `toggleSessions` | hotkey string | `'CommandOrControl+Shift+J'` | Show/hide the Sessions panel. [Shortcuts] |

Hotkeys use Tauri accelerator syntax (`CommandOrControl`, `Alt`, `Shift`, `Space`, letters…), max 64 characters.

## Privacy and integrations

| Key | Type | Default | Meaning |
|---|---|---|---|
| `privateMode` | boolean | `false` | Everything stays on this computer: local brain, STT and voice. [Privacy] |
| `screenAccess` | boolean | `false` | Opt-in for "what's on my screen?" / "explain this error": one screenshot per request (≤ 2 MB, never stored) is shown to a vision-capable brain. Off = Jarvis explains how to enable it and captures nothing. [Privacy] |
| `openResults` | boolean | `true` | Automatically open viewable results (HTML file, localhost URL) when a session finishes. [Agents & projects] |
| `historyRetentionDays` | integer 0–3650 | `30` | Days of conversation history to keep; `0` = don't keep. [Privacy] |
| `relayUrl` | string | `''` | URL of your ChatGPT relay; empty = not configured. [Integrations] |
| `relayExposeWriteTools` | boolean | `false` | Expose write tools (speak, ask, notify, start task, remember) to ChatGPT through the relay. Read-only tools only by default. [Integrations] |

## Environment variables

| Variable | Meaning |
|---|---|
| `JARVIS_DATA_DIR` | Overrides the data directory. |
| `JARVIS_LAUNCH_TOKEN` | Internal: launch token passed from the shell to the sidecar. Never set this yourself. |
