# Microphone, wake word and transcription

Jarvis is built so that the microphone is **useful without being creepy**: the wake word is detected on your computer, a visible indicator shows whenever the mic is live, and audio leaves the computer only if you chose a cloud transcription provider — and only after a command has been captured.

## Ways to start listening

| Trigger | Setting | Default | Notes |
|---|---|---|---|
| Wake word **"Jarvis"** | `wakeWord` | on | On-device keyword spotting. |
| Push-to-talk | `pushToTalk` | `Alt+Space` (`⌥ Space` on macOS) | Hold = listen, release = send. On Windows `Alt+Space` opens the window menu; we suggest `Ctrl+Alt+Space`. Change it in Settings › Shortcuts. |
| Double clap | `wakeOnClap` | off | Only while Jarvis is idle. |
| Conversation mode | `conversationMode` | on | Keeps listening after a reply, without the wake word. |
| Typing / chips | — | — | Home window composer or suggestion chips. |

The Sessions panel shortcut is `toggleSessions` (default `Cmd/Ctrl+Shift+J`).

> **Linux Wayland:** global shortcuts depend on your compositor and desktop portal. On some setups push-to-talk only works while a Jarvis window is focused. The wake word is unaffected.

## How a request is captured

1. Wake word (or shortcut/clap) → the pill appears and the orb reacts to your voice.
2. **Voice-activity detection** (Silero VAD) decides when you have finished: about **1.2 s of silence** ends the request; a request is cut at **30 s** maximum.
3. The audio is transcribed (locally by default) and the text goes to Jarvis.
4. In **conversation mode** Jarvis keeps listening for `conversationWindowMs` (default **6 s**, range 2–20 s) after it finishes speaking, so you can just carry on.

Barge-in: speak (or say "stop") while Jarvis is talking and it stops. **Echo cancellation** (`echoCancellation`, on by default) prevents Jarvis from hearing itself through your speakers.

## Local transcription (Whisper)

Default: `stt = local-whisper`, with whisper.cpp running on your computer. Pick the model size with `whisperModel`:

| Model | Approx. download | Speed | Accuracy | Good for |
|---|---|---|---|---|
| `tiny` | ~75 MB | fastest | basic | old computers, short commands |
| `base` | ~150 MB | very fast | fair | — |
| `small` (default) | ~470 MB | fast | good | most laptops, English and Italian |
| `medium` | ~1.5 GB | slower | very good | strong CPUs/GPUs |
| `large-v3-turbo` | ~1.6 GB | moderate on GPU | best | Apple Silicon, recent GPUs |

Models are downloaded on first use into the `models/` folder of the data directory, together with the small wake-word (sherpa-onnx keyword spotting) and VAD models.

## Cloud transcription (opt-in)

| `stt` | Needs | Notes |
|---|---|---|
| `openai` | OpenAI API key | Not covered by the ChatGPT plan. |
| `elevenlabs` | ElevenLabs API key | ElevenLabs Scribe. |

Even with cloud transcription, wake-word detection stays on-device and only the captured command (16 kHz audio) is uploaded. Private mode always switches back to local transcription.

## Privacy promises (security rule R11)

- A persistent **mic indicator** shows when the microphone is live.
- Wake-word detection runs **on device**; nothing is recorded or sent while Jarvis is waiting for "Jarvis".
- Raw microphone audio never leaves the native shell unless you enabled a cloud STT provider.
- Transcripts are kept in local history according to `historyRetentionDays` and can be deleted at any time ([Memory & privacy](memory-privacy.md)).

## Tips for reliable wake-word detection

- Speak at a normal volume, about an arm's length from the mic.
- If the TV triggers Jarvis, that is harmless for risky actions — high-risk steps always need a click ([Permissions](permissions.md)) — but you can turn off the wake word and use push-to-talk instead.
- Headsets give the best results in noisy rooms.

Not hearing you? See [Troubleshooting](troubleshooting.md#jarvis-does-not-hear-me).
