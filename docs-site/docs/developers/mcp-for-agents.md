---
title: "Use Jarvis from your agents"
description: "Give Claude Code, Codex and other MCP clients a voice: connect the jarvis-mcp server so agents can speak, ask you questions and start tasks."
---

# Use Jarvis from your agents

Jarvis ships an **MCP server**. Any MCP client — Claude Code, Codex, Claude Desktop, Cowork — can use
it to talk to you out loud, ask you a question and wait for the answer, notify you, or start a
background task.

::: callout tip "Why this is useful" icon:lightbulb
Long agent runs in a terminal are easy to forget. With Jarvis connected, the agent can *say* "I need you
to choose between Postgres and SQLite" and wait for your spoken answer — even when you're in another room.
:::

## How it connects

The MCP bridge is a single file, `jarvis-mcp.mjs`, shipped with the app and in the `jarvis-mcp-bundle.zip` release asset (run it with Node.js 20+). It is a small **stdio** bridge that finds the running
Jarvis through a connection file in the data directory (`run/agent-host.json`, owner-only permissions)
and forwards tool calls over the local, token-protected socket. Jarvis must be running.

Find the exact command for your OS in **Settings › Integrations › Copy command**.

::: tabs
== tab "Claude Code"
```bash
claude mcp add jarvis -- node /path/to/jarvis-mcp.mjs
```
Or install the plugin (MCP server + a skill that teaches Claude when to use Jarvis):
```text
/plugin marketplace add lopadova/jarvis-desktop
/plugin install jarvis@jarvis-desktop
```

== tab "Codex"
Add to `~/.codex/config.toml`:
```toml
[mcp_servers.jarvis]
command = "node"
args = ["/path/to/jarvis-mcp.mjs"]
tool_timeout_sec = 620
```

== tab "Any MCP client"
```json
{
  "mcpServers": {
    "jarvis": { "command": "node", "args": ["/path/to/jarvis-mcp.mjs"] }
  }
}
```
:::

## Tools

| Tool | What it does | Read-only |
|---|---|:---:|
| `jarvis_speak` | Say a short message (≤ 300 chars) | ❌ |
| `jarvis_ask_user` | Ask a question, optionally with up to 4 options, and wait (10–600 s, default 120) | ❌ |
| `jarvis_notify` | Silent desktop notification | ❌ |
| `jarvis_start_task` | Start a background task with Claude, Codex or Home | ❌ |
| `jarvis_list_sessions` | List sessions and their activity | ✅ |
| `jarvis_session_result` | Get a session's final result | ✅ |
| `jarvis_remember` | Save a preference or fact | ❌ |
| `jarvis_recall` | List what Jarvis remembers | ✅ |

Full schemas: [MCP tools reference](/reference/mcp-tools).

## Safety

Every MCP call is validated against its schema, shown in the Jarvis UI and passed through the same
permission policy as everything else. `jarvis_start_task` cannot skip approvals: risky steps still need
**your** confirmation on screen.

## Example prompt for your agent

```text
When you finish, call jarvis_speak with a one-sentence summary.
If you need a decision from me, use jarvis_ask_user with at most three options.
```
