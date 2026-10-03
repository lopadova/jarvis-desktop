---
title: "Quickstart"
description: "Get Jarvis talking in a few minutes: pick the path that matches what you already have — a ChatGPT plan, Claude Code, Codex, API keys, or nothing at all."
---

# Quickstart

Pick the path that matches what you already have. Every path starts the same way: install the app
([details per OS](/get-started/install)), then the welcome wizard guides you.

::: callout tip "Not sure which brain to pick?" icon:lightbulb
If you pay for **ChatGPT Plus or Pro**, start there: no API key, no extra bill. If you are a developer
with **Claude Code** or **Codex**, use that. No subscription at all? Use an **API key** or go **fully
local**. You can connect several brains and switch any time. [Compare brains →](/guides/brains)
:::

::: tabs
== tab "Home user"
1. Download the installer for your computer from the
   [latest release](https://github.com/lopadova/jarvis-desktop/releases/latest).
2. Open it (v0.1 is unsigned — [one extra click](/get-started/install)).
3. Allow the microphone, choose **Continue with ChatGPT**, pick a voice.
4. Say *"Jarvis, good morning"*.

Prefer a guide holding your hand? Paste `https://github.com/lopadova/jarvis-desktop` into ChatGPT or
Claude and say *"install Jarvis for me"*. [How it works →](/get-started/install-with-ai)

== tab "ChatGPT Plus/Pro"
1. In the wizard step **Choose your brain**, click **Continue with ChatGPT**.
2. Your browser opens the ChatGPT sign-in page. Approve access for *Jarvis Desktop*.
3. Set a **weekly cap** for Jarvis on the OpenAI consent screen (you can change it later).
4. Back in Jarvis, the account row shows your plan and a usage bar.

Your plan covers **text** (understanding and answering). Voice output and cloud transcription use a
separate provider — the default is local or your OS voice, so it costs nothing.

== tab "Claude Code"
1. Install Claude Code and sign in once in a terminal:
   ```bash
   npm install -g @anthropic-ai/claude-code
   claude
   ```
2. In the wizard choose **Use Claude Code**. Jarvis detects it (found / not found / needs login).
3. Claude Code becomes both a brain and an agent for project work.

== tab "Codex"
1. Install the Codex CLI and sign in with your ChatGPT account:
   ```bash
   npm install -g @openai/codex
   codex login
   ```
2. In **Settings › Brain & accounts**, select **Codex**. In **Agents & projects** you can make Codex the
   default agent, or say *"do the same with Codex"* any time.

== tab "No subscription"
**API keys:** in the wizard choose **Use an API key** and paste an Anthropic or OpenAI key. Keys are
stored in your OS keyring, never in files.

**Fully local:** install [Ollama](https://ollama.com) and pull a model, then choose **Run locally**:
```bash
ollama pull llama3.2
```
Pick **Kokoro** or **Piper** as the voice and keep **local Whisper** for transcription. Nothing leaves
your computer.

== tab "Developers"
```bash
git clone https://github.com/lopadova/jarvis-desktop.git
cd jarvis-desktop
pnpm install
pnpm sidecar:build
pnpm dev
```
You need Node 22+, pnpm, Rust (stable) and Bun. [Full dev setup →](/contributing/dev-setup)
:::

## Your first five minutes

::: steps
1. **Check the clock** — *"Jarvis, what time is it?"* (answered instantly, no AI needed).
2. **Set a timer** — *"Jarvis, timer for 10 minutes."*
3. **Copy any paragraph, then** — *"Jarvis, summarise what I copied."*
4. **Teach it something** — *"Jarvis, remember that I prefer short answers."*
5. **Delegate a task** — *"Jarvis, find the September electricity bill PDF."* Watch the sessions panel
   (`Ctrl+Shift+J` / `⌘⇧J`).
:::

Next: [what Jarvis can do](/everyday/features) · [use it inside Claude](/integrations/cowork-claude-desktop) ·
[use it inside ChatGPT](/integrations/chatgpt).
