---
title: "What Jarvis can do"
description: "Every everyday feature of Jarvis, grouped like the suggestion chips on the Home screen, with phrases in English and Italian."
---

# What Jarvis can do

These are the same categories you see as **suggestion chips** on the Home screen. Click a chip, or say
the phrase under it. Phrases are examples — speak naturally.

::: callout info "What each feature needs" icon:info
**Instant** = handled on your computer without AI (works offline). **Brain** = needs a connected brain.
**Agent** = runs as a background session (Claude Code, Codex or the Home agent). **Calendar / Email** =
needs your calendar or mail MCP server connected. **Screen / Clipboard** = reads it only when you ask
(screen access is off until you enable it in Settings › Privacy).
:::

## ☀️ Your day

| Feature | Say (EN) | Dillo in italiano | Needs |
|---|---|---|---|
| Morning briefing | "Jarvis, good morning" | "Jarvis, buongiorno" | Agent |
| What's on today | "Jarvis, what do I have today?" | "Jarvis, cosa ho in programma oggi?" | Calendar |
| Meeting prep | "Jarvis, prepare me for my next meeting" | "Jarvis, preparami per la prossima riunione" | Calendar, Agent |

Say just "good morning" / "buongiorno": Jarvis starts a background session on the Home agent with a
read-only task — today's weather (only if you told Jarvis where you live, e.g. *"remember that I live in
Milan"*), today's calendar events and important unread mail from the tools you connected. When it is
done you hear a summary of at most 60 words and get a **Morning briefing** card with the details. The
agent never sends, accepts or deletes anything during a briefing.

## ⏰ Timers, alarms and reminders

| Feature | Say (EN) | Dillo in italiano | Needs |
|---|---|---|---|
| Timer | "Jarvis, timer for 10 minutes" | "Jarvis, timer di 10 minuti" | Instant |
| Reminder | "Jarvis, remind me in 20 minutes to call Marco" | "Jarvis, ricordami tra 20 minuti di chiamare Marco" | Instant |
| Alarm | "Jarvis, alarm at 7:30" | "Jarvis, sveglia alle 7:30" | Instant |
| Reminder at a time | "Jarvis, remind me tomorrow at 9 to pay the rent" | "Jarvis, domani alle 9 ricordami di pagare l'affitto" | Brain |

Timers, alarms and reminders are stored locally and fire even if your internet is down.

## ✍️ Writing and clipboard

| Feature | Say (EN) | Dillo in italiano | Needs |
|---|---|---|---|
| Summarise | "Jarvis, summarise what I copied" | "Jarvis, riassumi quello che ho copiato" | Clipboard, Brain |
| Translate | "Jarvis, translate what I copied into English" | "Jarvis, traduci in inglese quello che ho copiato" | Clipboard, Brain |
| Fix grammar | "Jarvis, fix the grammar of what I copied" | "Jarvis, correggi quello che ho copiato" | Clipboard, Brain |
| Dictation | "Jarvis, dictate" | "Jarvis, dettatura" | Instant |
| Polite reply | "Jarvis, write a polite reply to the last email" | "Jarvis, scrivi una risposta gentile all'ultima mail" | Email, Agent |

**Clipboard.** When you mention what you copied (*copied*, *clipboard* / *copiato*, *appunti*), Jarvis
reads the clipboard at that moment and your brain does exactly what you asked. You hear a short reply;
the full text appears in a **From your clipboard** card with a **Copy** button, or say *"copy it"* /
*"copialo"*. The copied text is treated as data, never as instructions, at most 8,000 characters are
sent, and nothing of it is saved in your history. In private mode only a local brain is used.

**Dictation.** After *"dictate"* / *"dettatura"* the pill shows **Dictation** and the **next** thing you
say is typed into the app that has focus — never sent to an AI, never stored. Say *"stop dictation"* /
*"fine dettatura"* or press **Esc** to cancel; it also ends by itself after a minute.

## 🖥️ Your screen

| Feature | Say (EN) | Dillo in italiano | Needs |
|---|---|---|---|
| Describe screen | "Jarvis, what's on my screen?" | "Jarvis, cosa vedo sullo schermo?" | Screen, Brain |
| Explain an error | "Jarvis, explain this error" | "Jarvis, spiegami questo errore" | Screen, Brain |

::: callout warning "Opt-in" icon:shield-alert
Screen questions are **off by default**. Turn on **Settings › Privacy › Screen access** first; until then
Jarvis explains how to enable it and captures nothing.
:::

Once enabled, one screenshot is taken **only when you ask**, shrunk below 2 MB, shown to a brain that can
read images for that one question, and never stored. Brains that can see: ChatGPT (your plan), the OpenAI
and Anthropic APIs, and local vision models (e.g. `llava`). If your brain is Claude Code or Codex, Jarvis
uses ChatGPT or your local model when connected — never a pay-per-use API on its own. In private mode
only a local model may see the screen; otherwise nothing is captured.

## 📁 Files

| Feature | Say (EN) | Dillo in italiano | Needs |
|---|---|---|---|
| Find a document | "Jarvis, find the September electricity bill PDF" | "Jarvis, trova il PDF della bolletta della luce di settembre" | Agent |
| Tidy a folder | "Jarvis, tidy up my Downloads folder" | "Jarvis, metti in ordine la cartella Download" | Agent |

Moving files inside the workspace is allowed; deleting anything asks you first.

## 🌐 Web

| Feature | Say (EN) | Dillo in italiano | Needs |
|---|---|---|---|
| Research | "Jarvis, look up reviews of the latest Pixel" | "Jarvis, cerca le recensioni dell'ultimo Pixel" | Agent |
| Compare | "Jarvis, compare the two laptops I copied" | "Jarvis, confronta i due portatili che ho copiato" | Agent |

## 🏠 Home and family

| Feature | Say (EN) | Dillo in italiano | Needs |
|---|---|---|---|
| Shopping list | "Jarvis, add milk to the shopping list" | "Jarvis, aggiungi il latte alla lista della spesa" | Instant |
| Weather | "Jarvis, what's the weather tomorrow?" | "Jarvis, che tempo fa domani?" | Agent |
| Recipe | "Jarvis, a recipe with eggs, spinach and feta" | "Jarvis, una ricetta con uova, spinaci e feta" | Brain |

The shopping list is stored on your computer. Add several items at once (*"add milk, eggs and bread to
the shopping list"*), ask *"what's on the shopping list?"* / *"cosa c'è nella lista della spesa?"*,
remove (*"remove eggs from the shopping list"* / *"togli le uova dalla lista della spesa"*) or clear it
(*"clear the shopping list"* / *"svuota la lista della spesa"*). Each change shows a **Shopping list**
card; the newest one lets you remove items with a click.

## 🧠 Memory

| Feature | Say (EN) | Dillo in italiano | Needs |
|---|---|---|---|
| Teach | "Jarvis, remember that I prefer short answers" | "Jarvis, ricordati che preferisco risposte brevi" | Brain |
| Recall | "Jarvis, what do you know about me?" | "Jarvis, cosa sai di me?" | Instant |
| Forget | "Jarvis, forget that I prefer short answers" | "Jarvis, dimentica che preferisco risposte brevi" | Brain |

*"What do you know about me?"* reads out up to five recent memories plus how many more there are, and
opens **Home › Memory**, where everything Jarvis remembers is listed and you can edit or delete it.
[Memory & privacy →](/security/privacy)

## 🔒 Privacy

| Feature | Say (EN) | Dillo in italiano | Needs |
|---|---|---|---|
| Local mode | "Jarvis, switch to local mode" | "Jarvis, passa alla modalità locale" | Instant |
| Leave local mode | "Jarvis, private mode off" | "Jarvis, disattiva la modalità privata" | Instant |
| Forget today | "Jarvis, delete today's history" | "Jarvis, cancella la cronologia di oggi" | Instant |

*Forget today* deletes today's conversation and history, including the request itself. Memories,
sessions and the shopping list are kept.

## 🛠️ Developer

| Feature | Say (EN) | Dillo in italiano | Needs |
|---|---|---|---|
| Build | "Jarvis, in project shop add a footer" | "Jarvis, nel progetto shop aggiungi il footer" | Agent |
| Status | "Jarvis, how's it going?" | "Jarvis, a che punto sei?" | Instant |
| Open result | "Jarvis, open the result" | "Jarvis, apri il risultato" | Brain |
| Switch agent | "Jarvis, do the same with Codex" | "Jarvis, rifallo con Codex" | Agent |

[Developers guide →](/developers/agents)

## Always available

- **Stop talking:** "stop" / "basta" — interrupts Jarvis immediately.
- **Repeat:** "repeat" / "ripeti".
- **Stop everything:** "stop everything" / "ferma tutto".
- **Usage meter and history** with search live in Home.

The full list of instant phrases is in [Voice commands](/reference/voice-commands).
