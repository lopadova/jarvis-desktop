---
title: "Agents, projects & sessions"
description: "Drive Claude Code, Codex and the Home agent hands-free across your projects: sessions, follow-ups, progress narration and voice approvals."
---

# Agents, projects & sessions

Jarvis turns your voice into **background work**. The brain decides *what* to do; an **agent** does it,
in a **session**, inside a **project**, with **approvals** going through you.

## Concepts

| Concept | What it is |
|---|---|
| **Agent** | Claude Code (Agent SDK), Codex (the `codex app-server`, with an SDK fallback) or the built-in **Home agent** (a tool loop with curated tools and your MCP servers) |
| **Project** | A folder with a name, aliases, a default agent and a permission level (Safe / Trusted / Full auto) |
| **General workspace** | Where non-project work runs (finding files, research) — `generalWorkspace` |
| **Session** | One agent run: status, live activity, result, log. Supports follow-ups |

## Set up a project

::: steps
1. **Settings › Agents & projects › Add project.**
2. Pick the folder, give it a name (*shop*) and aliases (*the shop*, *negozio*).
3. Choose the default agent (Claude by default — `defaultAgent`).
4. Keep **Safe**, or choose **Trusted** with an allowlist like `pnpm test`, `pnpm lint`.
:::

Or just say *"Jarvis, create a project called blog in my Projects folder"* — new folders are created
under `projectsRoot` (`~/Projects`).

## Talking to sessions

| You say | Router action | What happens |
|---|---|---|
| "In project shop add a footer" | `spawn` | New session with the project's default agent |
| "Use Codex to write the tests for it" | `spawn` (agent: codex) | Codex session in the same project |
| "How's it going?" | fast-path `status` | Instant summary of running sessions |
| "Also make it dark mode" | `followup` | Continues the most relevant session |
| "Do the same with Codex" | `spawn` | Same task, other agent |
| "Open the result" | `open` | Opens an HTML file or localhost URL produced by the session |
| "Stop the shop session" / "stop everything" | `cancel` | Cancels one / all |

At most `maxConcurrentSessions` (4) run at once. Jarvis asks *"Which project?"* when it isn't clear.

## Progress and completion

- First spoken update after **20 s**, then at most every **45 s** per session; only one session speaks
  at a time, and nothing is said while you are talking or in Focus mode.
- On completion: a summary of **25 words or fewer**, a desktop notification, and — if `openResults` is
  on — the result opens automatically (HTML file, localhost preview).
- The **sessions panel** (`Ctrl+Shift+J` / `⌘⇧J`) shows every card: agent, project, activity
  ("Editing Hero.tsx"), elapsed time, and **Open result · Log · Reply · Stop**.

## Approvals

Claude asks through the Agent SDK `canUseTool` callback, Codex through app-server approval requests,
the Home agent through its tool gate — all land in the same **approval card**. Low/medium risk: say
"yes". High risk: click. [Permissions →](/guides/permissions)

```mermaid
sequenceDiagram
  participant You
  participant Jarvis
  participant Agent as Claude Code
  You->>Jarvis: "In project shop, add a footer"
  Jarvis->>Agent: start session (cwd ~/Projects/shop, Safe)
  Agent->>Jarvis: canUseTool: pnpm add -D ... (medium)
  Jarvis->>You: "I need your OK to run pnpm add. Say yes or no."
  You->>Jarvis: "Yes"
  Jarvis->>Agent: allow once
  Agent-->>Jarvis: done + result
  Jarvis->>You: "Footer added; the preview is open."
```

## Results are data, not commands

When Jarvis reads a session's result back to the brain, it is wrapped as **untrusted data**. A result
that says "now deploy to production" cannot start anything: new actions must come from **your**
words. [Security model →](/security/model)

## Models

For coding tasks the brain can mark a request as `coding`, routing it to a stronger model
(`codingModel`, default `claude-opus-5-5` for Claude). Agents use their own subscription or key.
