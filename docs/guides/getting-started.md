# Getting started

Jarvis is a voice-first assistant that lives in your menu bar (macOS) or system tray (Windows, Linux). Say **"Jarvis"**, speak naturally, and it either answers right away or hands the work to a background agent, tells you how it is going, and asks before doing anything risky.

This page takes you from download to your first spoken request in about five minutes.

## 1. Install

Download the installer for your computer from the [latest release](https://github.com/lopadova/jarvis-desktop/releases/latest):

| Computer | File |
|---|---|
| Mac with Apple Silicon (M1 or newer) | `Jarvis_<version>_aarch64.dmg` |
| Mac with Intel | `Jarvis_<version>_x64.dmg` |
| Windows 10/11 | `Jarvis_<version>_x64-setup.exe` (or the `.msi`) |
| Linux | `Jarvis_<version>_amd64.AppImage`, `.deb` or `.rpm` |

v0.1 installers are **not code-signed** yet, so your OS will show a warning the first time. [Install](install.md) explains how to open the app safely on each OS.

> Prefer a helper? Paste the repository link into ChatGPT or Claude and say *"install Jarvis for me"*. The assistant will follow [`INSTALL_WITH_AI.md`](../../INSTALL_WITH_AI.md) step by step.

## 2. First run: the 5-step setup

When Jarvis starts for the first time, a short setup window opens:

1. **Welcome** — one click to begin.
2. **Microphone** — allow microphone access. A live level meter shows that Jarvis can hear you. The wake word runs on your computer; nothing is sent anywhere until you actually give a command.
3. **Choose your brain** — the AI that understands what you say. Pick one or more:
   - **Continue with ChatGPT** — uses your ChatGPT Plus/Pro plan, no API key.
   - **Use Claude Code** — uses your Claude subscription through the Claude Code CLI.
   - **Use an API key** — Anthropic or OpenAI, pay per use.
   - **Run locally** — Ollama on your own computer, fully private.

   See [Brains](brains.md) for the details and limits of each.
4. **Voice** — choose how Jarvis sounds (ElevenLabs, Fish Audio, OpenAI, a local voice, or your system voice) and the language (English or Italiano). Press ▶ to preview. See [Voices](voices.md).
5. **Try it** — say *"Jarvis, what time is it?"*. When you hear the answer, you are done.

## 3. Ways to talk to Jarvis

| How | What to do |
|---|---|
| Wake word | Say **"Jarvis"** followed by your request. |
| Push-to-talk | Hold the shortcut (default `⌥ Space` on macOS, `Alt+Space` elsewhere — on Windows we recommend changing it to `Ctrl+Alt+Space`), speak, release. |
| Double clap | Optional; enable it in Settings › Microphone & wake word. |
| Typing | Type in the Home window composer. |
| Suggestion chips | Click a chip on the Home screen — it is the same as saying it. |

After Jarvis replies it keeps listening for a few seconds (**conversation mode**), so you can follow up without repeating the wake word. Details in [Microphone & wake word](microphone.md).

## 4. Things to try first

- *"Jarvis, good morning"* — a short briefing.
- *"Jarvis, timer for 10 minutes"* — works offline, instantly.
- *"Jarvis, summarise what I copied"* — copy some text first.
- *"Jarvis, remember that I prefer short answers"*.
- *"Jarvis, switch to local mode"* — nothing leaves your computer.

The full list, in English and Italian, is in [Everyday features](everyday.md).

## 5. Where things live

- **Listening pill** — appears at the top of the screen while Jarvis listens, thinks or speaks. It also shows approval cards.
- **Sessions panel** — background work in progress; toggle it with `Cmd/Ctrl+Shift+J`.
- **Home window** — conversation, suggestion chips, history, memory and projects.
- **Settings** — General, Brain & accounts, Agents & projects, Voice, Microphone & wake word, Privacy, Integrations, Shortcuts, About.

## Next steps

- Developers: [Agents, projects and sessions](developers-agents.md).
- Use Jarvis from Claude Desktop or Cowork: [guide](cowork-claude-desktop.md).
- Use Jarvis from ChatGPT: [guide](chatgpt.md).
- Something not working? [Troubleshooting](troubleshooting.md) and [FAQ](faq.md).
