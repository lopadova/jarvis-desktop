# Everyday features

You don't need to be technical to get value from Jarvis. These are the things people use it for every day. Each one appears as a **suggestion chip** on the Home screen — clicking a chip is the same as saying the phrase.

Italian is fully supported: every phrase below has an Italian equivalent (labelled **IT**). Switch language in Settings › General (`locale`).

Some features need something extra, marked in the **Needs** column:

| Need | Meaning |
|---|---|
| *agent* | A background agent is available: Claude Code, Codex, or the built-in Home agent. |
| *calendar* / *email* | You connected a calendar or email MCP server (Settings › Integrations). |
| *clipboard* | Jarvis reads your clipboard when you ask. |
| *screen* | You allowed screen capture (opt-in; macOS asks for Screen Recording permission). |
| *developer* | At least one project is registered and Claude Code or Codex is installed. |

The Home screen's **For you** tab only shows chips whose needs are met, ranked by time of day (briefing in the morning, alarm in the evening, recipes around meal times).

## Your day

| Chip | Say (EN) | Say (IT) | Needs |
|---|---|---|---|
| Morning briefing | "Jarvis, good morning" | "Jarvis, buongiorno" | agent |
| What's on today? | "Jarvis, what do I have today?" | "Jarvis, cosa ho in programma oggi?" | calendar |
| Prep my next meeting | "Jarvis, prepare me for my next meeting" | "Jarvis, preparami per la prossima riunione" | calendar, agent |

## Timers, alarms and reminders

These work **offline and instantly** — no AI needed. Jarvis confirms out loud and notifies you when they fire.

| Chip | Say (EN) | Say (IT) | Needs |
|---|---|---|---|
| Set a timer | "Jarvis, timer for 10 minutes" | "Jarvis, timer di 10 minuti" | — |
| Remind me later | "Jarvis, remind me in 20 minutes to call Marco" | "Jarvis, ricordami tra 20 minuti di chiamare Marco" | — |
| Wake me up | "Jarvis, alarm at 7:30" | "Jarvis, sveglia alle 7:30" | — |

More phrasings (e.g. "half an hour", "un'ora e mezza") are in [Voice commands](../reference/voice-commands.md). Reminders at a specific date or time ("remind me tomorrow at 9 to…") are understood by the brain.

## Writing

| Chip | Say (EN) | Say (IT) | Needs |
|---|---|---|---|
| Summarise what I copied | "Jarvis, summarise what I copied" | "Jarvis, riassumi quello che ho copiato" | clipboard |
| Translate clipboard | "Jarvis, translate what I copied into English" | "Jarvis, traduci in inglese quello che ho copiato" | clipboard |
| Fix my writing | "Jarvis, fix the grammar of what I copied" | "Jarvis, correggi quello che ho copiato" | clipboard |
| Dictate here | "Jarvis, dictate" | "Jarvis, dettatura" | — |
| Reply politely | "Jarvis, write a polite reply to the last email" | "Jarvis, scrivi una risposta gentile all'ultima mail" | email, agent |

**Dictation** types what you say into the app you are using (macOS asks for Accessibility permission the first time). Email replies are **drafted**; sending needs your approval.

## What's on my screen

| Chip | Say (EN) | Say (IT) | Needs |
|---|---|---|---|
| What am I looking at? | "Jarvis, what's on my screen?" | "Jarvis, cosa vedo sullo schermo?" | screen |
| Explain this error | "Jarvis, explain this error" | "Jarvis, spiegami questo errore" | screen |

Jarvis takes a screenshot only when you ask, sends it to your brain for that one question, and does not keep it. Not available in private mode unless your local model supports images.

## Files

| Chip | Say (EN) | Say (IT) | Needs |
|---|---|---|---|
| Find a document | "Jarvis, find the September electricity bill PDF" | "Jarvis, trova il PDF della bolletta della luce di settembre" | agent |
| Tidy my Downloads | "Jarvis, tidy up my Downloads folder" | "Jarvis, metti in ordine la cartella Download" | agent |

Moving or deleting files outside a project always asks first ([Permissions](permissions.md)).

## Web research

| Chip | Say (EN) | Say (IT) | Needs |
|---|---|---|---|
| Research something | "Jarvis, look up reviews of the latest Pixel" | "Jarvis, cerca le recensioni dell'ultimo Pixel" | agent |
| Compare two products | "Jarvis, compare the two laptops I copied" | "Jarvis, confronta i due portatili che ho copiato" | agent |

Research runs as a background session: you can keep working and ask *"how's it going?"*. When it's done you get a short spoken summary and the full result in the Home window.

## Home and family

| Chip | Say (EN) | Say (IT) | Needs |
|---|---|---|---|
| Shopping list | "Jarvis, add milk to the shopping list" | "Jarvis, aggiungi il latte alla lista della spesa" | — |
| Tomorrow's weather | "Jarvis, what's the weather tomorrow?" | "Jarvis, che tempo fa domani?" | agent |
| Cook with what I have | "Jarvis, a recipe with eggs, spinach and feta" | "Jarvis, una ricetta con uova, spinaci e feta" | — |

## Developer

| Chip | Say (EN) | Say (IT) | Needs |
|---|---|---|---|
| Build something | "Jarvis, in project shop add a footer" | "Jarvis, nel progetto shop aggiungi il footer" | developer |
| How's it going? | "Jarvis, how's it going?" | "Jarvis, a che punto sei?" | developer |
| Open the result | "Jarvis, open the result" | "Jarvis, apri il risultato" | developer |
| Switch to Codex | "Jarvis, do the same with Codex" | "Jarvis, rifallo con Codex" | developer |

See [Developers: agents, projects and sessions](developers-agents.md).

## Memory

| Chip | Say (EN) | Say (IT) | Needs |
|---|---|---|---|
| Teach me something about you | "Jarvis, remember that I prefer short answers" | "Jarvis, ricordati che preferisco risposte brevi" | — |
| What do you know about me? | "Jarvis, what do you know about me?" | "Jarvis, cosa sai di me?" | — |

Everything Jarvis remembers is visible and editable in Home › Memory. See [Memory & privacy](memory-privacy.md).

## Privacy

| Chip | Say (EN) | Say (IT) | Needs |
|---|---|---|---|
| Go fully local | "Jarvis, switch to local mode" | "Jarvis, passa alla modalità locale" | — |
| Forget today | "Jarvis, delete today's history" | "Jarvis, cancella la cronologia di oggi" | — |

## Also handy

- **Usage meter** — the Home footer shows how much of your ChatGPT plan cap Jarvis has used.
- **History with search** — every conversation, searchable, kept for `historyRetentionDays` (default 30).
- **"Stop"** — interrupts Jarvis at any moment. *"Stop everything"* cancels all running sessions.
