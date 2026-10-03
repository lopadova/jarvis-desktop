---
title: "Install with an AI helper"
description: "Let ChatGPT or Claude walk you through installing Jarvis step by step — no technical knowledge needed."
---

# Install with an AI helper

Not comfortable installing apps from GitHub? Let the AI you already use guide you.

::: steps
1. **Open ChatGPT or Claude** in your browser or app.
2. **Paste this message:**
   ```text
   Please help me install Jarvis on my computer, step by step.
   Instructions for you are here:
   https://github.com/lopadova/jarvis-desktop/blob/main/INSTALL_WITH_AI.md
   ```
3. **Answer its questions.** It will ask which computer you have, tell you which file to download, and
   explain each warning you might see.
4. **It asks before every important step** — downloading, opening an unsigned app, granting the
   microphone, signing in. You stay in control.
:::

## Why this works

The repository contains `INSTALL_WITH_AI.md`, a guide written **for AI assistants**: it tells them how to
detect your operating system, which release file to choose, how to open unsigned v0.1 builds safely, how
to grant microphone access and how to complete the welcome wizard — with explicit "ask the user before…"
checkpoints. There is also an `llms.txt` file at the root that points AI tools to the most useful docs.

::: callout warning "Safety first" icon:shield-alert
A good helper never asks for your passwords or API keys in the chat. Sign-ins happen in your browser or
in Jarvis itself. Only download Jarvis from `github.com/lopadova/jarvis-desktop/releases`.
:::

Prefer to do it yourself? Follow the [install guide](/get-started/install).
