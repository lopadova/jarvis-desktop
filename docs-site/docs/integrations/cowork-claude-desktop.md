---
title: "Claude Desktop & Cowork"
description: "Install the Jarvis extension in Claude Desktop and Claude Cowork with one click, so Claude can speak to you, ask you questions and start tasks on your computer."
---

# Claude Desktop & Cowork

Use Jarvis **from inside Claude**. Once connected, Claude can say things out loud on your computer, ask
you a question and wait for your spoken answer, and hand long tasks to Jarvis's agents.

## Option 1 — One-click extension (`.mcpb`)

::: steps
1. **Download** `jarvis.mcpb` from the
   [latest release](https://github.com/lopadova/jarvis-desktop/releases/latest)
   (the **Install extension** button in Settings › Integrations is "coming soon" in v0.1).
2. **Open it** — double-click the file, or in Claude Desktop go to **Settings › Extensions** and drag it
   in. Review the permissions and click **Install**.
3. **Keep Jarvis running.** The extension talks to the Jarvis app on your computer.
4. **Try it** — in a Claude chat: *"Use Jarvis to tell me out loud when you're done."*
:::

## Option 2 — Cowork / Claude Code plugin

The plugin bundles the MCP server and a skill that teaches Claude when and how to use Jarvis (short
spoken summaries, asking before blocking, never chatty).

```text
/plugin marketplace add lopadova/jarvis-desktop
/plugin install jarvis@jarvis-desktop
```

## Option 3 — Manual MCP configuration

Add to Claude Desktop's `claude_desktop_config.json` (**Settings › Developer › Edit config**):

```json
{
  "mcpServers": {
    "jarvis": { "command": "node", "args": ["/path/to/jarvis-mcp.mjs"] }
  }
}
```

Replace `/path/to/jarvis-mcp.mjs` with the real path from **Jarvis › Settings › Integrations › Copy
command**.

## What Claude can do with it

::: grids
  ::: grid
    ::: card "Speak" icon:volume-2
    `jarvis_speak` — "The report is ready on your desktop."
    :::
  :::
  ::: grid
    ::: card "Ask you" icon:message-circle-question
    `jarvis_ask_user` — "Should I send it to Marco or Giulia?" Answer by voice or click.
    :::
  :::
  ::: grid
    ::: card "Start a task" icon:play
    `jarvis_start_task` — hand off work to Claude Code, Codex or the Home agent on your machine.
    :::
  :::
  ::: grid
    ::: card "Check on work" icon:activity
    `jarvis_list_sessions`, `jarvis_session_result` — read-only.
    :::
  :::
:::

::: callout info "Your rules still apply" icon:shield-check
Calls from Claude are shown in Jarvis and go through your permission policy. Anything risky still needs
your confirmation on screen.
:::

See all tools in the [MCP tools reference](/reference/mcp-tools).
