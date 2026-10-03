# Voices: how Jarvis sounds

Jarvis speaks its replies with streaming text-to-speech (TTS), so you hear the first sentence while the rest is still being written. Pick a provider in Settings › Voice (setting `tts`) and press ▶ to preview voices.

> ChatGPT plan sign-in does **not** cover audio. Voices are always a separate choice — and several are free and local.

## Providers

| Provider | `tts` value | Needs | Expressive cues | Notes |
|---|---|---|---|---|
| **System voice** | `system` | nothing | no | Default. Uses macOS / Windows / Linux speech. Works offline. |
| **ElevenLabs** | `elevenlabs` | ElevenLabs API key | yes with `eleven_v3` | Most natural and expressive; many voices and languages. |
| **Fish Audio** | `fish` | Fish Audio API key | yes | Expressive, good multilingual voices. Model `s2-pro` by default (`fishModel`). |
| **OpenAI** | `openai` | OpenAI **API key** | no | Clear and fast. Not covered by the ChatGPT plan. |
| **Kokoro** | `kokoro` | local download | no | High-quality local voice. Free, private. |
| **Piper** | `piper` | local download | no | Very light local voices, including Italian voices. Free, private. |

API keys are stored in the OS keyring only.

## ElevenLabs models

Choose with `elevenlabsModel`:

| Model | Best for | How it streams |
|---|---|---|
| `eleven_v3` (default) | Expressive replies with audio tags (laughs, sighs, whispers…) | HTTP streaming |
| `eleven_flash_v2_5` | Lowest latency, snappy short answers | WebSocket streaming |
| `eleven_multilingual_v2` | Stable, high-quality multilingual narration | HTTP streaming |

`eleven_v3` does not support the WebSocket input-streaming endpoint, so Jarvis uses HTTP streaming for it; if you want the fastest possible first word, pick `eleven_flash_v2_5` (cues are then removed).

## Expressive cues

The brain may add a few **neutral cues** to a reply, for example `[happy] Done! [laugh] the footer behaved.` Jarvis translates them into each provider's own dialect and strips them for providers that do not support them. At most **three** effects are kept per reply, so Jarvis never overacts.

| Neutral cue | ElevenLabs v3 | Fish Audio |
|---|---|---|
| `happy` | `[happy]` | `[happy]` |
| `excited` | `[excited]` | `[excited]` |
| `calm` | `[calm]` | `[relaxed]` |
| `curious` | `[curious]` | `[curious]` |
| `sad` | `[sad]` | `[sad]` |
| `empathetic` | `[sympathetic]` | `[empathetic]` |
| `surprised` | `[surprised]` | `[surprised]` |
| `proud` | `[proudly]` | `[proud]` |
| `worried` | `[nervous]` | `[worried]` |
| `laugh` | `[laughs]` | `[laughing]` |
| `chuckle` | `[chuckles]` | `[chuckling]` |
| `sigh` | `[sighs]` | `[sighing]` |
| `whisper` | `[whispers]` | `[whispering]` |
| `pause` | `[short pause]` | `[break]` |
| `long-pause` | `[long pause]` | `[long-break]` |
| `emphasis` | *(removed)* | `[emphasis]` |

Other providers (OpenAI, Kokoro, Piper, system) receive clean text. Markdown, code blocks, bullets and links are always turned into plain spoken text.

## Local voices and Italian

- **Piper** has several Italian voices and runs on almost any computer.
- **Kokoro** sounds more natural but needs a bit more CPU.
- The voice is chosen per language (`ttsVoice` maps a locale to a voice id), so English and Italian can each have their own voice.
- Local voices are downloaded the first time you select them, into the `models/` folder of the data directory.

## What Jarvis says out loud

| Setting | Default | Effect |
|---|---|---|
| `speakReplies` | on | Speak replies to your requests. |
| `speakProgress` | on | Short progress updates for background sessions (first after ~20 s, then at most every ~45 s). |
| `speakSummaries` | on | A short summary (≤ 25 words) when a session finishes. |
| `muteDuringFocus` | on | Stay quiet while the OS Focus / Do Not Disturb mode is on (where supported). |
| `speakingRate` | 1.0 | 0.5 (slow) to 2.0 (fast). |

Only one session speaks at a time, and Jarvis never talks over you: say **"stop"** (or *"basta"*) to interrupt it immediately.

## Choosing quickly

- **Free and private:** Piper or Kokoro.
- **Most natural:** ElevenLabs `eleven_v3` or Fish Audio.
- **Fastest:** ElevenLabs `eleven_flash_v2_5`, or the system voice.
- **Already have an OpenAI API key:** OpenAI TTS.
