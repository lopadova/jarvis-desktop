---
title: "Troubleshooting"
description: "Fixes for the most common Jarvis problems: install warnings, microphone, wake word, brains, voices, agents and the ChatGPT relay."
---

# Troubleshooting

::: collapsible "macOS says Jarvis “cannot be opened” or is “damaged”"
v0.1 builds are unsigned. Right-click Jarvis in Applications › **Open**, or **System Settings › Privacy &
Security › Open Anyway**. If it still says "damaged", run
`xattr -dr com.apple.quarantine /Applications/Jarvis.app` in Terminal. [Install guide](/get-started/install)
:::

::: collapsible "Windows shows “Windows protected your PC”"
That's SmartScreen warning about an unsigned app. Click **More info › Run anyway**. Make sure the file
came from `github.com/lopadova/jarvis-desktop/releases`.
:::

::: collapsible "Jarvis doesn't hear me"
1. Check the tray menu: is the microphone muted?
2. Check OS permission (macOS Privacy & Security › Microphone; Windows Privacy › Microphone).
3. In **Settings › Microphone & wake word**, pick the right input device and watch the level meter.
4. Try push-to-talk: if that works, the issue is the wake word (see below).
:::

::: collapsible "The wake word triggers too often or not at all"
Speak "Jarvis" clearly, then pause briefly. Noisy rooms and far microphones hurt detection. If it fires
from TV or music, that's harmless — risky actions still need you — but you can switch to push-to-talk
only by turning off `wakeWord`.
:::

::: collapsible "Transcriptions are wrong"
Use a larger `whisperModel` (`medium` or `large-v3-turbo`), check that the UI language matches what you
speak (English/Italiano), or try a cloud transcription provider.
:::

::: collapsible "Jarvis hears itself / interrupts itself"
Keep `echoCancellation` on, lower the speaker volume or use headphones.
:::

::: collapsible "“I don't have a brain connected yet”"
Open **Settings › Brain & accounts** and connect ChatGPT, Claude Code, Codex, an API key or a local
model. Instant commands (time, timers, reminders) work without one.
:::

::: collapsible "ChatGPT: “weekly allowance used up”"
You reached the cap you set for Jarvis. Raise it in your ChatGPT account, wait for the reset, or switch
to another connected brain. Jarvis never switches to a paid API automatically.
:::

::: collapsible "Claude Code or Codex “isn't installed or isn't signed in”"
Run `claude` or `codex login` once in a terminal. If installed in a custom place, set `claudePath` /
`codexPath` in **Settings › Agents & projects**.
:::

::: collapsible "Ollama doesn't respond"
Make sure Ollama is running (`ollama serve`) and the model is pulled (`ollama pull llama3.2`). Check
`localBrain.baseUrl` (default `http://127.0.0.1:11434/v1`).
:::

::: collapsible "No voice / robotic voice"
Check the selected `tts` provider and key. Local voices download on first use — give it a minute.
The System voice always works as a fallback.
:::

::: collapsible "A session is stuck waiting"
It is probably waiting for an approval: open the sessions panel (`Ctrl+Shift+J` / `⌘⇧J`). Say "stop
everything" to cancel all sessions.
:::

::: collapsible "Push-to-talk doesn't work on Linux"
On Wayland, global shortcuts depend on the compositor. Use the wake word, or log in to an X11 session.
:::

::: collapsible "ChatGPT says “Jarvis is offline on your computer”"
Jarvis must be running and paired with the relay. Check **Settings › Integrations › ChatGPT**: the relay
status should be *connected*. Re-pair if you redeployed the relay. [ChatGPT guide](/integrations/chatgpt)
:::

## Logs and reporting a bug

Diagnostic logs (secrets redacted) are in the `logs` folder of your data directory: `app.log` and one
file per session in `logs/sessions`. Open an issue with your OS, Jarvis version and steps to reproduce:
[new issue](https://github.com/lopadova/jarvis-desktop/issues/new/choose). Security problems go through
[private reporting](https://github.com/lopadova/jarvis-desktop/security/advisories/new), never a public
issue.
