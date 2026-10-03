---
title: "Voices"
description: "Choose how Jarvis sounds: ElevenLabs (expressive v3 or low-latency Flash), Fish Audio, OpenAI, local Kokoro/Piper, or your system voice."
---

# Voices

Jarvis speaks every reply, progress update and summary — streamed sentence by sentence, so it starts
talking before the whole answer is ready. Choose a provider in **Settings › Voice**, press ▶ to preview,
and pick a voice per language.

## Providers

| Provider | Setting `tts` | Account | Strengths | Notes |
|---|---|---|---|---|
| **System** (default) | `system` | none | Free, offline, instant | Quality depends on your OS voices |
| **Kokoro** | `kokoro` | none | Natural local voice, offline | Optional: needs the `kokoro-js` package next to the sidecar; English only; ~90 MB model fetched on first use |
| **Piper** | `piper` | none | Very light, offline, English and Italian voices | Binary and voice (en_US-lessac, it_IT-paola) downloaded on first use, SHA-256 verified |
| **ElevenLabs** | `elevenlabs` | API key | Most expressive; emotion tags | Paid beyond free tier |
| **Fish Audio** | `fish` | API key | Expressive, great multilingual | Default model `s2-pro` |
| **OpenAI** | `openai` | OpenAI API key | Clear, reliable | Not covered by a ChatGPT plan |

## ElevenLabs: v3 or Flash?

::: tabs
== tab "eleven_v3 (default)"
The most expressive model. Supports **audio tags** like `[happy]`, `[whispers]`, `[sighs]`, so Jarvis can
sound pleased when a task finishes or sympathetic when something fails. Streamed over HTTP.
Slightly higher latency.

== tab "eleven_flash_v2_5"
The fastest model, streamed over WebSocket for the lowest time-to-first-word. No expressive tags — cues
are removed and the text is spoken plainly. Best when you want snappy replies.

== tab "eleven_multilingual_v2"
A stable multilingual model; no audio tags.
:::

## Expressive cues

The brain writes neutral cues (`happy`, `calm`, `laugh`, `sigh`, `whisper`, `pause`…). Jarvis
translates them to each provider's dialect — ElevenLabs v3 tags, Fish tags — and strips them for
providers that don't support them. At most **three** effects per reply: expressive, never theatrical.

## Speaking behaviour

| Setting | Default | What it does |
|---|---|---|
| `speakingRate` | `1` | Speed, 0.5–2× |
| `speakReplies` | on | Speak answers |
| `speakProgress` | on | Spoken progress for long sessions (first after 20 s, then at most every 45 s) |
| `speakSummaries` | on | Short summary (≤ 25 words) when a session finishes |
| `muteDuringFocus` | on | Stay silent during Focus / Do Not Disturb where the OS exposes it |

Say **"stop"** (or "basta") at any time to interrupt. With echo cancellation on, you can also just start
talking over Jarvis (barge-in).

## Cost and privacy

Local and system voices cost nothing and never leave your computer. Cloud voices receive only the text
Jarvis is about to say. API keys live in the OS keyring. In **private mode**, Jarvis uses a local voice.
