# Troubleshooting

Start here: open Jarvis › Settings › **About**. It shows the version, the status of each provider and a **Copy diagnostics** button (redacted — no keys or tokens) you can paste into a bug report.

Logs live in the data directory under `logs/app.log` (paths in [Memory & privacy](memory-privacy.md#where-your-data-lives)).

## The app won't open

- **macOS: "Jarvis can't be opened because Apple cannot check it for malicious software."** v0.1 is unsigned. Right-click the app › **Open**, or System Settings › Privacy & Security › **Open Anyway**. See [Install](install.md#macos-12-monterey-or-newer).
- **Windows: "Windows protected your PC".** Click **More info** › **Run anyway**.
- **Windows: "An application control policy has blocked this file".** That is **Smart App Control**: it only lets signed apps (and unsigned ones it happens to know) run, and its verdict on a given unsigned file can change over time. Use a signed release when one exists, or run Jarvis from source (see [Install](install.md)), or turn Smart App Control off (a one-way switch on most Windows 11 builds, so check first). On a development machine, `JARVIS_SIDECAR_REPO=PATH_TO_CHECKOUT` runs the assistant process with Bun from source instead of the bundled `agent-host.exe`.
- **Linux AppImage does nothing.** Make it executable: `chmod +x Jarvis_<version>_amd64.AppImage`. Run it from a terminal to see errors.
- **No tray icon on GNOME.** Install the *AppIndicator and KStatusNotifierItem Support* extension.

## Jarvis does not hear me

1. Is the mic indicator lit when you hold push-to-talk? If not, check OS permissions:
   - macOS: System Settings › Privacy & Security › **Microphone** › Jarvis on.
   - Windows: Settings › Privacy & security › **Microphone** › "Let desktop apps access your microphone".
   - Linux: check the input device in your sound settings (PipeWire/PulseAudio).
2. Settings › Microphone & wake word: choose the right input device and watch the level meter.
3. Wake word not triggering? Speak a little closer, say "Jarvis" clearly, or use push-to-talk. Check `wakeWord` is on, and keep `wakeByRecognition` on if you have an Italian accent: the keyword spotter alone misses many Italian pronunciations (see [Microphone](microphone.md#how-the-wake-word-works)).
4. First use: the local models may still be downloading. If you chose a Whisper size that is not downloaded, Jarvis falls back to an installed one; with none installed it shows a notice. Settings › Microphone & wake word lists each model with its download button.
5. Linux Wayland: global push-to-talk may not work outside Jarvis windows — the wake word still does.

## It hears me but understands the wrong words

- Use a bigger Whisper model (`whisperModel`: `small` → `medium` or `large-v3-turbo`).
- Check the language: Settings › General (`locale`).
- In noisy rooms, use a headset.

## It triggers by itself

The TV or a video said something like "Jarvis". This is harmless for risky actions (high risk always needs a click), but you can disable `wakeWord` or `wakeOnClap` and use push-to-talk.

## No voice / silence

- Settings › Voice › press ▶ preview. If preview is silent, check the output device and system volume.
- Cloud voices need a valid API key. Settings › Voice shows **Ready** or **Needs setup** for the provider you picked. If it cannot speak (no key, voice not downloaded, no credit left, request failed) Jarvis says so and uses the system voice instead. Fish Audio bills its API credit separately from the subscription ("Insufficient API credit").
- `speakReplies` must be on. During Focus / Do Not Disturb Jarvis stays quiet if `muteDuringFocus` is on.
- Jarvis hears itself, interrupts itself or answers itself in a loop? Echo cancellation is not available yet. Interrupting by speaking (`bargeIn`) is off by default, the microphone is ignored for a moment after each reply and transcripts that repeat the last reply are dropped; if it still loops on your speakers, turn off conversation mode or use headphones.

## "I don't have a brain connected yet"

Connect one in Settings › Brain & accounts. See [Brains](brains.md).

## "Your weekly allowance for Jarvis is used up"

Your ChatGPT plan cap for Jarvis is reached. Raise the cap in your ChatGPT account settings, wait for the weekly reset, or choose another brain. Jarvis deliberately does **not** switch to a paid API on its own.

## Claude Code / Codex "isn't installed or isn't signed in"

- Run `claude` (or `codex`) in a terminal and complete the login.
- If the CLI is installed in a non-standard location, set `claudePath` / `codexPath` in Settings › Agents & projects.

## A session is stuck

- Check the Sessions panel: is it waiting for **approval**? Look for the amber card in the pill.
- Say "how's it going?" or open the session **Log**.
- "Stop everything" cancels all sessions. Orphaned agent processes are cleaned up at next start.

## "I already have N things running"

You reached `maxConcurrentSessions` (default 4). Wait for one to finish or raise the limit.

## Local brain is slow or confused

Try a smaller/faster model, or a larger one if your hardware allows. Check that Ollama is running (`ollama list`) and that the base URL is `http://127.0.0.1:11434/v1`.

## Claude Desktop / Cowork can't see Jarvis tools

See [Claude Desktop & Cowork](cowork-claude-desktop.md#troubleshooting). Jarvis must be running.

## ChatGPT says "Jarvis is offline on your computer"

- Jarvis must be running and paired: Settings › Integrations › ChatGPT should say *Connected*.
- Re-pair if you redeployed the relay.
- See [ChatGPT](chatgpt.md).

## Still stuck?

Search [existing issues](https://github.com/lopadova/jarvis-desktop/issues) or open a new one with your diagnostics. Security problems: please follow [SECURITY.md](../../SECURITY.md) instead of opening a public issue.
