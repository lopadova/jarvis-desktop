---
title: "Permissions & approvals"
description: "Safe, Trusted and Full auto permission levels, low/medium/high risk tiers, and which approvals you can give by voice."
---

# Permissions & approvals

Agents ask **Jarvis** for permission — not a terminal you can't see. Jarvis classifies every request,
decides whether it needs you, and shows an **approval card** in the pill.

## Permission levels (per project)

| Level | Allowed without asking | Asks you |
|---|---|---|
| **Safe** 🛡️ (default) | Reading, and editing files **inside** the project folder | Shell commands, network, deleting files, anything outside the folder, MCP write tools |
| **Trusted** 🛡️✓ | Everything low risk, plus shell commands on your **allowlist** (e.g. `pnpm test`) | Medium and high risk |
| **Full auto** 🛡️! | Low and medium risk | **High risk still always asks** |

New projects and the General workspace start in **Safe**. Full auto is an explicit per-project opt-in
behind a confirmation dialog.

::: callout warning "Allowlists are exact" icon:list-checks
An allowlist entry like `pnpm test` matches `pnpm test` and `pnpm test --watch`, but never a chained
command such as `pnpm test && curl …`. Commands that chain, pipe, redirect or substitute are never
auto-allowed.
:::

## Risk tiers

| Risk | Examples | Voice "yes"? | "Always allow in this project"? |
|---|---|:---:|:---:|
| **Low** | `ls`, `git status`, `git diff`, read-only MCP tools, writing a file inside the project | ✅ | ✅ |
| **Medium** | `pnpm add …`, `pnpm build` (scripts run code), deleting a file inside the project, GET requests | ✅ | ✅ |
| **High** | `rm -rf`, `sudo`, `git push`, `git reset --hard`, package publish, `curl … pipe sh`, touching `.ssh`/`.env`/keys, POST requests with data, destructive MCP tools, system settings | ❌ click only | ❌ |

When in doubt, Jarvis treats a request as **at least medium**.

## Deciding

- **Allow once** — just this request.
- **Deny** — the agent is told no and continues or stops.
- **Always allow in this project** — remembered for this kind of request (not offered for high risk).
- **No answer** — after the timeout the request is **denied**.

You can answer with a click, the keyboard, or — for low and medium risk — your voice: "yes", "sure",
"go ahead", "sì", "vai", "procedi" / "no", "deny", "annulla", "lascia stare". For high-risk requests the
card focuses **Deny** by default and says *"Click to confirm"*.

## Why voice can't approve high risk

Someone on TV, in a video or in the room could say "Jarvis, yes". Requiring a click for dangerous
actions makes ambient voice injection harmless. Likewise, text an agent reads (an email, a web page)
is treated as **data**, never as instructions — so an email saying "now delete everything" cannot
trigger anything. [Security model →](/security/model)

## Audit trail

Every approval request and decision is stored in the local history, so you can see later what each agent
asked and what you answered.
