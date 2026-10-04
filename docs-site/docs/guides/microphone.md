---
title: "Microphone & wake word"
description: "How Jarvis listens: on-device wake word, push-to-talk, double clap, conversation mode, local Whisper, cloud speech-to-text and the privacy promise."
---

# Microphone & wake word

::: callout tip "The privacy promise" icon:shield-check
The wake word runs **on your computer**. Nothing is sent anywhere until a command has been captured —
and even then, only to a cloud transcription service if you chose one. A visible indicator shows
whenever the microphone is live.
:::

## Ways to wake Jarvis

| Trigger | How | Setting |
|---|---|---|
| **Wake word** | Say "Jarvis" | `wakeWord` (on) |
| **Wake word by speech recognition** | Say a short phrase starting with "Jarvis" / "Giarvis" / "Hey Jarvis" | `wakeByRecognition` (on) |
| **Push-to-talk** | Hold the shortcut, speak, release | `pushToTalk` (`Alt+Space`) |
| **Double clap** | Clap twice, only when idle | `wakeOnClap` (off) |
| **Type or click** | Home composer or a suggestion chip | — |
| **Conversation mode** | After a reply, keep talking without "Jarvis" | `conversationMode` (on), `conversationWindowMs` (6000) |

On macOS the push-to-talk default shows as `⌥Space`. On Windows, `Alt+Space` opens many apps' window
menu — `Ctrl+Alt+Space` is a good choice. Change it in **Settings › Shortcuts** (the recorder warns
about conflicts).

## What happens when you speak

```mermaid
flowchart LR
  A[Mic audio] --> B[Wake word - on device]
  B --> C[Voice activity detection]
  C -->|1.2 s silence or 30 s max| D{Transcription}
  D -->|default| E[Local Whisper]
  D -->|opt-in| F[OpenAI / ElevenLabs Scribe]
  E --> G[Transcript to Jarvis]
  F --> G
```

Raw audio never crosses into the app logic: the native shell runs wake word, voice detection and
local transcription and passes on **text only**. Audio is sent to a cloud provider only if you select
one in `stt`.

## Transcription engines

| Engine | Setting `stt` | Privacy | Notes |
|---|---|---|---|
| **Local Whisper** (default) | `local-whisper` | Stays on device | Choose a model size below |
| OpenAI transcribe | `openai` | Audio sent to OpenAI | Needs an OpenAI API key |
| ElevenLabs Scribe | `elevenlabs` | Audio sent to ElevenLabs | Needs an ElevenLabs key |

### Whisper model sizes

| `whisperModel` | Approx. download | Good for |
|---|---|---|
| `tiny` | ~115 MB | Older computers, quick commands |
| `base` | ~210 MB | Light machines |
| `small` (default) | ~640 MB | Best balance, good Italian |
| `medium` | ~1.9 GB | Accents, noisy rooms |
| `large-v3-turbo` | ~565 MB | Highest accuracy on a fast machine |

Speech models (wake word, voice detection, Whisper) are downloaded with **Settings › Microphone & wake
word › Download models** into the `models` folder of the data directory. Local voices (Piper) download on
first use. Sizes are approximate.

### How the wake word works

Two detectors run while Jarvis is idle, both on your computer.

- **Keyword spotting** is a tiny model that listens for "Jarvis". It is fast and light but trained on English speech: in a test with one Italian speaker it recognised 1 of 8 recordings, while all 5 English synthetic voices were recognised.
- **Speech recognition** (`wakeByRecognition`) transcribes short phrases (up to about 4 seconds) with Whisper and checks whether they **start with** the wake word. In the same test it heard "Jarvis" or "Giarvis" in 5 of 8. Anything that does not start with the wake word is discarded. "Jarvis, che ore sono?" runs the command at once; just "Jarvis" keeps the microphone open for your command.

Whisper listens in the interface language, so with Italian selected, speak Italian. It uses more CPU than keyword spotting and needs a Whisper model.

## Echo cancellation and barge-in

Acoustic echo cancellation is **not available yet**: the `echoCancellation` setting is a placeholder. Meanwhile Jarvis ignores
transcripts that mostly repeat what it said a moment ago. On speakers it can still hear itself, so use headphones or lower the
volume.

## Permissions per OS

- **macOS:** System Settings › Privacy & Security › Microphone › Jarvis.
- **Windows:** Settings › Privacy & security › Microphone › allow desktop apps.
- **Linux:** check your PulseAudio/PipeWire input device and that no sandbox blocks it.

Mute the mic from the tray menu at any time. See also [Troubleshooting](/guides/troubleshooting).
