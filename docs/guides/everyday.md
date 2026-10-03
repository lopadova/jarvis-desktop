# Everyday features

You don't need to be technical to get value from Jarvis. These are the things people use it for every day. Each one appears as a **suggestion chip** on the Home screen — clicking a chip is the same as saying the phrase.

Italian is fully supported: every phrase below has an Italian equivalent (labelled **IT**). Switch language in Settings › General (`locale`).

Some features need something extra, marked in the **Needs** column:

| Need | Meaning |
|---|---|
| *agent* | A background agent is available: Claude Code, Codex, or the built-in Home agent. |
| *calendar* / *email* | You connected a calendar or email MCP server (Settings › Integrations). |
| *clipboard* | Jarvis reads your clipboard when you ask. |
| *screen* | You turned on **Screen access** (Settings › Privacy, `screenAccess`, off by default; macOS also asks for Screen Recording permission). |
| *developer* | At least one project is registered and Claude Code or Codex is installed. |

The Home screen's **For you** tab only shows chips whose needs are met, ranked by time of day (briefing in the morning, alarm in the evening, recipes around meal times).

## Your day

| Chip | Say (EN) | Say (IT) | Needs |
|---|---|---|---|
| Morning briefing | "Jarvis, good morning" | "Jarvis, buongiorno" | agent |
| What's on today? | "Jarvis, what do I have today?" | "Jarvis, cosa ho in programma oggi?" | calendar |
| Prep my next meeting | "Jarvis, prepare me for my next meeting" | "Jarvis, preparami per la prossima riunione" | calendar, agent |

**Morning briefing.** Saying just "good morning" / "buongiorno" starts a background session on the Home agent (or your default agent if the Home agent is not available) with a read-only task: today's weather — only if you told Jarvis where you live, e.g. *"remember that I live in Milan"* — today's calendar events and your important unread emails, read through the calendar and mail tools you connected. Jarvis says *"Good morning! Let me put your briefing together"*, and when the agent finishes you hear a summary of at most 60 words and see a **Morning briefing** card with the weather, events and emails. If no tools are connected, the agent simply tells you so. The agent never sends, accepts or deletes anything during a briefing.

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

**Clipboard.** When your request mentions what you copied (*copied*, *clipboard*; IT *copiato*, *appunti*), Jarvis reads the clipboard at that moment and asks your brain to do exactly what you said: summarise, translate, fix, compare or answer a question about it. You hear a short spoken reply; the full text (the translation, the corrected text, a longer summary) appears in a **From your clipboard** card with a **Copy** button. Say *"copy it"* / *"copialo"* to put the result back on the clipboard. The copied text is treated as data, never as instructions (it cannot start a task), at most 8,000 characters are sent, and neither the clipboard nor the result is saved in your history. In private mode only a local brain is used.

**Dictation.** Say *"dictate"* / *"dettatura"*: Jarvis answers *"Dictation on"*, the pill shows **Dictation**, and the **next** thing you say is typed into the app you are using — it is not sent to any AI and not stored. Then Jarvis goes back to normal. Say *"stop dictation"* / *"fine dettatura"* or press **Esc** to cancel; dictation also ends by itself after a minute. macOS asks for Accessibility permission the first time.

Email replies are **drafted**; sending needs your approval.

## What's on my screen

| Chip | Say (EN) | Say (IT) | Needs |
|---|---|---|---|
| What am I looking at? | "Jarvis, what's on my screen?" | "Jarvis, cosa vedo sullo schermo?" | screen |
| Explain this error | "Jarvis, explain this error" | "Jarvis, spiegami questo errore" | screen |

Screen questions are **off by default**. Until you turn on **Settings › Privacy › Screen access**, Jarvis explains how to enable it and captures nothing. Once enabled, Jarvis takes **one** screenshot of your main screen only when you ask, shrinks it below 2 MB, sends it to a brain that can see images for that one question, and keeps it nowhere (not on disk, not in history). Anything written on screen is treated as data, never as instructions.

Which brain looks at the screenshot:

- your primary brain if it can read images: ChatGPT (your plan), the OpenAI API, the Anthropic API, or a local model with vision (for example `llava` or `llama3.2-vision`; a text-only local model gives a clear "cannot read images" message);
- if your primary brain is Claude Code or Codex (which can't take images), Jarvis uses ChatGPT or your local model when they are connected — it **never** switches to a pay-per-use API on its own;
- in private mode, only a local model: otherwise the screenshot is not even taken.

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

**Shopping list.** The list lives on your computer and works offline, without any AI:

| To | Say (EN) | Say (IT) |
|---|---|---|
| Add | "add milk, eggs and bread to the shopping list" | "aggiungi il latte e le uova alla lista della spesa" |
| Hear it | "what's on the shopping list?" | "cosa c'è nella lista della spesa?" |
| Remove | "remove eggs from the shopping list" | "togli le uova dalla lista della spesa" |
| Clear | "clear the shopping list" | "svuota la lista della spesa" |

Each change shows a **Shopping list** card in the conversation; the newest card has a remove button next to every item. Duplicates are ignored ("eggs" and "egg" count as the same item).

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

*"What do you know about me?"* is answered on your computer, without AI: Jarvis reads out up to five of the most recent things it remembers, tells you how many more there are, and opens the **Memory** view, where everything Jarvis remembers is visible and editable. See [Memory & privacy](memory-privacy.md).

## Privacy

| Chip | Say (EN) | Say (IT) | Needs |
|---|---|---|---|
| Go fully local | "Jarvis, switch to local mode" | "Jarvis, passa alla modalità locale" | — |
| Forget today | "Jarvis, delete today's history" | "Jarvis, cancella la cronologia di oggi" | — |

**Forget today** deletes today's conversation and history (including the request itself), confirms out loud and clears the Home conversation. Memories, sessions and the shopping list are not touched. The same button is in Settings › Privacy.

## Also handy

- **Usage meter** — the Home footer shows how much of your ChatGPT plan cap Jarvis has used.
- **History with search** — every conversation, searchable, kept for `historyRetentionDays` (default 30).
- **"Stop"** — interrupts Jarvis at any moment. *"Stop everything"* cancels all running sessions.
