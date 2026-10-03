---
title: "Memory & privacy"
description: "What Jarvis stores, where, for how long, what leaves your computer and when — plus private/local mode and how to delete everything."
---

# Memory & privacy

::: callout tip "The short version" icon:shield-check
Jarvis keeps its data in **one local database** on your computer and secrets in your **OS keyring**.
Nothing is ever sent to the Jarvis project. Data reaches an AI provider only when that provider is the
one you chose for a request — and in **private mode**, nothing leaves at all.
:::

## Memory

Memory is what you asked Jarvis to remember: *"remember that I prefer short answers"*, *"my sister is
called Anna"*. It helps the brain personalise replies.

- **See it:** Home › Memory, or ask *"what do you know about me?"*.
- **Edit or delete:** in the UI (with undo), or say *"forget that…"*. Forgetting works by the memory's
  id, never by fuzzy matching, so Jarvis cannot accidentally forget the wrong thing.
- **Clear all:** Settings › Privacy.

## What is stored, and where

| Data | Where | Retention |
|---|---|---|
| Conversation history, sessions, approvals, reminders, memory, settings | `jarvis.db` (SQLite) in the data directory | History: `historyRetentionDays` (30; 0 = keep nothing). Memory: until you delete it |
| Agent session logs | `logs/sessions` | With history |
| Diagnostic log (redacted) | `logs/app.log` | Rotated |
| Local models | `models` | Until you delete them |
| API keys, plan tokens, relay secret | OS keyring | Until you sign out or delete |

Data directory: macOS `~/Library/Application Support/Jarvis`, Windows `%APPDATA%\Jarvis`, Linux
`~/.local/share/jarvis`. Permissions are owner-only.

## What leaves your computer — and when

| Situation | Sent | To |
|---|---|---|
| Wake word, voice detection | Nothing | — |
| Local Whisper (default) | Nothing | — |
| Cloud transcription (opt-in) | The captured command audio | OpenAI or ElevenLabs |
| A brain request | Your words, recent turns, relevant memory, project names | Your chosen brain (ChatGPT, Claude, OpenAI, Anthropic) — or nobody if local |
| "What's on my screen?" | One screenshot, only when you ask | Your brain |
| "Summarise what I copied" | The clipboard text, only when you ask | Your brain |
| Cloud voice | The text Jarvis is about to say | ElevenLabs, Fish Audio or OpenAI |
| Agents | Whatever the task needs | The agent's provider; risky egress needs approval |
| ChatGPT relay | Only tool calls ChatGPT makes and their results (not stored) | Your own relay |

## Private / local mode

Say *"Jarvis, switch to local mode"* or use the tray. A **green ring** around the orb and a *Local only*
chip confirm it. In private mode Jarvis uses only local components: Ollama for the brain, Kokoro/Piper
or the system voice, local Whisper. Features that need a cloud service tell you they are unavailable.

## Delete everything

- *"Jarvis, delete today's history"* or Settings › Privacy › **Delete history** (today or all).
- Settings › Privacy › clear memory.
- Uninstall and delete the data directory; remove *Jarvis* entries from your keyring.
