---
title: "Settings reference"
description: "Every Jarvis setting with its type, default value and meaning, as defined by SettingsSchema in packages/core."
---

# Settings reference

Settings are defined by `SettingsSchema` in `packages/core/src/settings.ts` and stored in the local
database. Unknown keys are dropped and missing keys take their defaults, so settings stay compatible
across versions. **Secrets are never settings** — API keys and tokens live in the OS keyring.

You change settings in the **Settings** window; the tab is shown for each group.

## General

| Key | Type | Default | Meaning |
|---|---|---|---|
| `locale` | `en` \| `it` | `en` | Interface and voice language |
| `userName` | string (≤ 80) | empty | How Jarvis greets you |
| `onboardingComplete` | boolean | `false` | Whether the welcome wizard has been completed |
| `launchAtLogin` | boolean | `false` | Start Jarvis when you log in |
| `theme` | `system` \| `dark` \| `light` | `system` | Colour theme |
| `material` | `auto` \| `glass` \| `solid` | `auto` | Translucent glass or opaque surfaces (auto = glass where supported) |
| `accentHue` | number 0–360 | `200` | Accent colour hue (cyan by default) |

## Brain & accounts

| Key | Type | Default | Meaning |
|---|---|---|---|
| `primaryBrain` | `chatgpt` \| `claude` \| `codex` \| `api-anthropic` \| `api-openai` \| `local` \| null | `null` | The brain used for routing; null until you connect one |
| `localBrain.baseUrl` | string | `http://127.0.0.1:11434/v1` | OpenAI-compatible endpoint for the local brain (Ollama default) |
| `localBrain.model` | string | `llama3.2` | Local model name |
| `apiModels.anthropic` | string | `claude-haiku-4-5` | Model used with an Anthropic API key |
| `apiModels.openai` | string | `gpt-5-mini` | Model used with an OpenAI API key |
| `chatgptModel` | string | empty | Model used with Sign in with ChatGPT; empty = automatic, from the models your plan offers |
| `codingModel` | string | `claude-opus-5-5` | Stronger model for requests marked as coding |

## Agents & projects

| Key | Type | Default | Meaning |
|---|---|---|---|
| `defaultAgent` | `claude` \| `codex` \| `home` | `claude` | Agent used when none is specified |
| `maxConcurrentSessions` | integer 1–12 | `4` | Maximum background sessions running at once |
| `generalWorkspace` | path | empty | Folder for non-project work; empty = default location |
| `projectsRoot` | path | `~/Projects` | Where new projects are created |
| `claudePath` | path | empty | Custom path to the Claude Code CLI; empty = auto-detect |
| `codexPath` | path | empty | Custom path to the Codex CLI; empty = auto-detect |

Projects themselves (name, path, aliases, default agent, permission level, allowlist) are managed in
the same tab and stored separately.

## Voice

| Key | Type | Default | Meaning |
|---|---|---|---|
| `tts` | `elevenlabs` \| `fish` \| `openai` \| `kokoro` \| `piper` \| `system` | `system` | Text-to-speech provider |
| `ttsVoice` | map provider → voice id | empty | Chosen voice per provider |
| `elevenlabsModel` | `eleven_v3` \| `eleven_flash_v2_5` \| `eleven_multilingual_v2` | `eleven_v3` | ElevenLabs model (v3 = expressive tags; Flash = lowest latency) |
| `fishModel` | string | `s2-pro` | Fish Audio model |
| `speakingRate` | number 0.5–2 | `1` | Speech speed |
| `speakReplies` | boolean | `true` | Speak answers out loud |
| `speakProgress` | boolean | `true` | Spoken progress updates for long sessions |
| `speakSummaries` | boolean | `true` | Spoken summary when a session finishes |
| `muteDuringFocus` | boolean | `true` | Stay silent during Focus / Do Not Disturb |

## Microphone & wake word

| Key | Type | Default | Meaning |
|---|---|---|---|
| `stt` | `local-whisper` \| `openai` \| `elevenlabs` | `local-whisper` | Speech-to-text engine |
| `whisperModel` | `tiny` \| `base` \| `small` \| `medium` \| `large-v3-turbo` | `small` | Local Whisper model size |
| `wakeWord` | boolean | `true` | Listen for "Jarvis" (on device) |
| `wakeOnClap` | boolean | `false` | Double clap to wake (only when idle) |
| `conversationMode` | boolean | `true` | Keep listening briefly after a reply, without the wake word |
| `conversationWindowMs` | integer 2000–20000 | `6000` | How long conversation mode listens (ms) |
| `echoCancellation` | boolean | `true` | Remove Jarvis's own voice from the mic (enables barge-in) |

## Shortcuts

| Key | Type | Default | Meaning |
|---|---|---|---|
| `pushToTalk` | hotkey | `Alt+Space` | Hold to talk, release to send (shown as ⌥Space on macOS) |
| `toggleSessions` | hotkey | `CommandOrControl+Shift+J` | Show/hide the sessions panel |

## Privacy

| Key | Type | Default | Meaning |
|---|---|---|---|
| `privateMode` | boolean | `false` | Use only local components; nothing leaves the computer |
| `screenAccess` | boolean | `false` | Opt-in for "what's on my screen?": one screenshot per request (≤ 2 MB, never stored) shown to a vision-capable brain |
| `openResults` | boolean | `true` | Auto-open viewable results (HTML files, localhost URLs) when a session finishes |
| `historyRetentionDays` | integer 0–3650 | `30` | Days of history to keep; 0 = keep nothing |

## Integrations

| Key | Type | Default | Meaning |
|---|---|---|---|
| `relayUrl` | URL | empty | Your ChatGPT relay URL; empty = not paired |
| `relayExposeWriteTools` | boolean | `false` | Expose write tools (speak, ask, start task, remember…) through the relay; read-only otherwise |

## Secrets (keyring, not settings)

`openai-api-key`, `anthropic-api-key`, `elevenlabs-api-key`, `fish-audio-api-key`, plus ChatGPT plan
tokens and the relay pairing secret — stored in Keychain, Windows Credential Manager or Secret Service.

## Environment variables

| Variable | Meaning |
|---|---|
| `JARVIS_DATA_DIR` | Override the data directory |
