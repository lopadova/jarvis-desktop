---
title: "FAQ"
description: "Frequently asked questions about Jarvis: cost, privacy, subscriptions, platforms, languages and safety."
---

# FAQ

::: collapsible "Is Jarvis free?"
Yes. Jarvis is open source under the MIT license. It uses AI you already have — a ChatGPT plan, Claude
Code, Codex — or free local models. Optional cloud voices or API keys are billed by their providers.
:::

::: collapsible "Will Jarvis ever cost me money without asking?"
No. Jarvis never switches from a subscription to a pay-per-use API on its own. If you add an API key and
choose it as your brain, that usage is billed to you by the provider — your choice, visible in settings.
:::

::: collapsible "Does my ChatGPT plan pay for Jarvis's voice?"
No. Plan sharing covers text (understanding and replies) only. Voice uses a separate provider; the
default local/system voices are free.
:::

::: collapsible "Is it always listening?"
The wake word runs on your computer and nothing leaves it until a command is captured. A visible
indicator shows when the mic is live, and you can mute it from the tray. Turn the wake word off and use
push-to-talk if you prefer.
:::

::: collapsible "Can someone on TV make Jarvis delete my files?"
No. Risky actions need your approval, and high-risk ones need a **click** — voice is not enough. Text
that agents read is treated as data, not commands. [Security model](/security/model)
:::

::: collapsible "Which systems are supported?"
macOS (Apple silicon and Intel), Windows 10/11 64-bit, and Linux x64 (AppImage, deb, rpm).
:::

::: collapsible "Which languages?"
English and Italian at launch, for both the interface and voice. More languages are on the roadmap.
:::

::: collapsible "Can it run completely offline?"
Yes: local brain (Ollama), local voice (Kokoro/Piper or system) and local Whisper. Say *"Jarvis, switch
to local mode"*. Features that need the internet (web research, cloud MCP connectors) are unavailable.
:::

::: collapsible "Is there a mobile app?"
Not yet. A mobile **companion** (push-to-talk, live sessions, remote approvals, notifications) is on the
[roadmap](https://github.com/lopadova/jarvis-desktop/blob/main/ROADMAP.md).
:::

::: collapsible "Why are the installers unsigned?"
Signing certificates cost money; v0.1 ships unsigned with clear instructions. Signed and notarised
installers are planned.
:::

::: collapsible "Can I use Jarvis inside Claude or ChatGPT?"
Yes. Claude Desktop / Cowork via a one-click extension, Claude Code and Codex via MCP, ChatGPT via a free
relay you deploy. [Claude](/integrations/cowork-claude-desktop) · [ChatGPT](/integrations/chatgpt)
:::

::: collapsible "Where is my data?"
In one SQLite database in your app-data folder; secrets in the OS keyring. Nothing is sent to the Jarvis
project. [Memory & privacy](/security/privacy)
:::
