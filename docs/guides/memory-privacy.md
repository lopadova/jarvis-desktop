# Memory and privacy

Jarvis is a personal assistant, so it handles personal things. This page explains exactly what it keeps, where, and how to remove it.

## Memory

Memory holds **durable facts you asked Jarvis to remember** — preferences, names, habits:

> "Jarvis, remember that I prefer short answers."
> "Jarvis, remember that my sister is called Giulia."

- Everything in memory is **visible and editable** in Home › Memory, with the date and whether you said it or Jarvis inferred it.
- *"What do you know about me?"* reads it back.
- To forget: *"Jarvis, forget that I prefer short answers"*, or delete the item in the UI (with undo).
- Forgetting works **by memory id only** (security rule R12): the brain picks the exact item from the list it is shown, or you pick it in the UI. Jarvis never deletes memories by fuzzy word matching, so a stray phrase can't wipe something unrelated.
- **Clear all memory** is in Settings › Privacy.

Memory is sent to your brain as context so replies fit you. With a cloud brain, that means it reaches the provider along with your request; in private mode it stays local.

## Private mode

> "Jarvis, switch to local mode." / *"Jarvis, passa alla modalità locale."*

Private mode (`privateMode`) makes **everything stay on this computer**:

- local brain (Ollama or another local server),
- local transcription (Whisper),
- a local voice (Kokoro, Piper or the system voice),
- cloud-only features (e.g. ChatGPT, web research through cloud agents) are paused and Jarvis tells you when something is unavailable.

A **green ring** around the orb and a "Local only" chip show that private mode is on. *"Jarvis, private mode off"* turns it off.

## History

- Conversations (your requests, replies, session cards) are stored locally and searchable in Home › History.
- They are kept for `historyRetentionDays` days (default **30**; `0` = do not keep history).
- *"Jarvis, delete today's history"* removes today's entries. Settings › Privacy › **Delete history** removes everything.

## Where your data lives

All persistent state is in **one folder** on your computer, with owner-only permissions:

| OS | Data directory |
|---|---|
| macOS | `~/Library/Application Support/Jarvis` |
| Windows | `%APPDATA%\Jarvis` |
| Linux | `$XDG_DATA_HOME/jarvis` (default `~/.local/share/jarvis`) |

Set `JARVIS_DATA_DIR` to use a different folder.

| Path | Contents |
|---|---|
| `jarvis.db` | SQLite database: sessions, memories, conversation turns, reminders, approvals, settings |
| `logs/app.log` | Diagnostic log, rotated and **redacted** (tokens and keys removed) |
| `logs/sessions/<id>.ndjson` | Raw event log of each agent session |
| `run/agent-host.json` | Connection details for local MCP bridges (owner-only) |
| `models/` | Downloaded local models (wake word, VAD, Whisper, local voices) |

## Secrets

API keys, ChatGPT plan tokens, TTS keys and the relay pairing secret are stored **only in your OS keyring** — macOS Keychain, Windows Credential Manager, or the Secret Service on Linux (security rule R6). They never appear in the database, settings, logs or process command lines.

## What leaves your computer, and when

| Data | Goes to | When |
|---|---|---|
| Your request text (+ memory, recent turns, session summaries) | Your brain provider | Each request, unless the brain is local |
| Captured command audio | Your cloud STT provider | Only if you chose cloud STT; never the wake-word stream |
| Reply text | Your TTS provider | Only if you chose a cloud voice |
| Clipboard / screenshot | Your brain provider | Only when you ask about it |
| Agent work | Claude / OpenAI (via your agent) | When a session runs with a cloud agent |
| Tool calls from ChatGPT | Your own relay | Only if you set up the relay; nothing is stored there |

Jarvis has **no telemetry** of its own.

## Microphone

The wake word is detected on-device, a persistent indicator shows when the mic is live, and audio is never sent anywhere while Jarvis is waiting for "Jarvis". Details in [Microphone](microphone.md#privacy-promises-security-rule-r11).

## Deleting everything

1. Settings › Privacy › **Delete history** and **Clear memory**.
2. Sign out of each account in Settings › Brain & accounts (removes keyring entries).
3. Uninstall the app and delete the data directory listed above.
