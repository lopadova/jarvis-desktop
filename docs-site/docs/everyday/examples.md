---
title: "Examples by persona"
description: "Realistic things people say to Jarvis — at home, at work and while coding — and what happens next."
---

# Examples by persona

Real requests, what Jarvis does, and what you will hear. Italian examples are marked 🇮🇹 — Jarvis
understands and speaks English and Italian.

## At home

::: grids
  ::: grid
    ::: card "“Jarvis, good morning”" icon:sunrise
    The Home agent gathers weather, your first events and important mail. You hear: *"Morning! Light rain until ten, stand-up at 9:30, and a reply from the accountant is waiting."*
    :::
  :::
  ::: grid
    ::: card "“Jarvis, timer for pasta, 9 minutes”" icon:timer
    Instant, no AI involved. A countdown card appears in Home; at zero: *"Your pasta timer is done."*
    :::
  :::
  ::: grid
    ::: card "“Jarvis, add milk, eggs and coffee to the shopping list”" icon:shopping-cart
    Three items added. Ask *"what's on the shopping list?"* at the supermarket.
    :::
  :::
  ::: grid
    ::: card "🇮🇹 “Jarvis, una ricetta con uova, spinaci e feta”" icon:chef-hat
    Risposta breve a voce e ricetta completa nella Home, pronta da seguire.
    :::
  :::
:::

## At work

::: grids
  ::: grid
    ::: card "“Jarvis, summarise what I copied”" icon:clipboard-list
    You copied a long contract clause. You hear three sentences; the full summary sits in Home.
    :::
  :::
  ::: grid
    ::: card "“Jarvis, prepare me for my next meeting”" icon:users
    Reads the event, the attendees and related mail through your MCP connectors, then gives a 30-second brief.
    :::
  :::
  ::: grid
    ::: card "“Jarvis, write a polite reply to Giulia saying Thursday works”" icon:mail
    Drafts the reply. Sending is a write action, so an approval card asks you first.
    :::
  :::
  ::: grid
    ::: card "“Jarvis, find the September electricity bill PDF”" icon:file-search
    A Home-agent session searches your documents and says where it is; *"open it"* opens the file.
    :::
  :::
  ::: grid
    ::: card "🇮🇹 “Jarvis, traduci in inglese quello che ho copiato”" icon:languages
    Traduzione pronta negli appunti della Home, con un breve riepilogo a voce.
    :::
  :::
  ::: grid
    ::: card "“Jarvis, what's on my screen?”" icon:scan-eye
    One screenshot, taken because you asked, explained in plain words. Not stored.
    :::
  :::
:::

## While coding

::: grids
  ::: grid
    ::: card "“Jarvis, in project shop add a footer with the opening hours”" icon:hammer
    Starts a Claude Code session in `~/Projects/shop`. After 20 s: *"Editing Footer.tsx."* When done: *"Footer added; the preview is open."*
    :::
  :::
  ::: grid
    ::: card "“Jarvis, how's it going?”" icon:activity
    Instant status of every running session, one sentence each.
    :::
  :::
  ::: grid
    ::: card "“Yes” (to an approval)" icon:check
    *"I need your OK to run pnpm add -D vitest. Say yes or no."* — medium risk, so your voice is enough.
    :::
  :::
  ::: grid
    ::: card "“Jarvis, do the same with Codex”" icon:repeat
    Starts a Codex session with the same task, so you can compare results.
    :::
  :::
  ::: grid
    ::: card "🇮🇹 “Jarvis, a che punto sei?”" icon:activity
    Stato immediato delle sessioni in corso, senza chiamare l'AI.
    :::
  :::
  ::: grid
    ::: card "“Jarvis, push it”" icon:git-branch
    `git push` is high risk: no voice approval. *"I need your OK to push to origin. Please confirm on screen."*
    :::
  :::
:::

## From other AI tools

::: grids
  ::: grid
    ::: card "In Claude Cowork" icon:puzzle
    *"When the report is ready, tell me out loud."* Cowork calls `jarvis_speak` and your computer says it.
    :::
  :::
  ::: grid
    ::: card "In ChatGPT" icon:cloud
    *"Ask Jarvis what my sessions are doing."* ChatGPT calls `jarvis_list_sessions` through your relay.
    :::
  :::
:::

More phrases by category: [What Jarvis can do](/everyday/features).
