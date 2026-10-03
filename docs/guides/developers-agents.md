# Developers: agents, projects and sessions

Jarvis can drive coding agents hands-free across all your projects: start work by voice, ask how it is going, follow up, switch agents, and approve steps without touching the terminal.

## Concepts

| Concept | What it is |
|---|---|
| **Agent** | The worker that does the job: **Claude Code** (via the Claude Agent SDK), **Codex** (via the Codex SDK / app-server), or the built-in **Home agent** (a tool loop with curated tools plus your MCP servers). |
| **Project** | A folder with a name, optional aliases, a default agent and a permission level. |
| **General workspace** | Where non-project work runs (research, files, briefings). Configure its folder with `generalWorkspace`. |
| **Session** | One agent run, with live status, activity, result and log. Sessions can be continued with follow-ups. |

## Projects

Add projects in Settings › Agents & projects, or just ask:

> "Jarvis, create a project called *shop* in ~/Projects/shop"

Each project has:
- **Name** and **aliases** — so "the shop", "e-commerce" and "shop" all resolve to the same folder.
- **Path** — new projects default under `projectsRoot` (default `~/Projects`).
- **Default agent** — `claude`, `codex` or `home` (global default: `defaultAgent = claude`).
- **Permission level** — `safe` (default), `trusted` with an allowlist, or `full-auto`. See [Permissions](permissions.md).

The brain only targets **registered** projects; if it is not sure which one you mean, it asks (*"Which project?"*).

## Starting work

> "Jarvis, in project shop add a footer with the company address"

Jarvis turns your request into a self-contained task, picks the project's agent and starts a session. You hear *"On it, working on shop."* and a card appears in the Sessions panel (`Cmd/Ctrl+Shift+J`).

- **Pick an agent explicitly:** "…with Codex", "…using Claude".
- **Coding tasks** use the stronger `codingModel` (default `claude-opus-5-5`) for the Claude agent.
- **Parallel work:** up to `maxConcurrentSessions` sessions run at once (default 4, max 12). Beyond that Jarvis asks you to wait.

## Following along

| You say | What happens |
|---|---|
| "How's it going?" / "A che punto sei?" | Instant status of running sessions (no LLM needed). |
| "What did it change?" | Answered from the session's result. |
| "Also make it responsive" | A **follow-up** to the same session (it resumes with context). |
| "Do the same with Codex" | A new session on the same task with the other agent. |
| "Open the result" | Opens the result: an HTML file, a localhost URL, the folder or the editor. |
| "Stop" / "Stop everything" | Stops speaking / cancels all sessions. |

Progress narration (`speakProgress`): the first spoken update comes after about **20 s**, then at most every **45 s** per session. Only one session speaks at a time, and Jarvis stays quiet while you talk or during Focus/Do Not Disturb (`muteDuringFocus`).

On completion you get a short spoken summary (≤ 25 words), a desktop notification and — if `openResults` is on — viewable results open automatically.

## Approvals

Agents ask Jarvis, and Jarvis asks you, through an approval card in the pill:

- Claude Code — Agent SDK `canUseTool` callback.
- Codex — app-server approval requests.
- Home agent — its own tool gate.

Low and medium risk: say "yes" or "no". High risk (`git push`, `rm -rf`, publishing, credentials…): click. "Always allow in this project" is available for low/medium risk. No answer → denied. Full rules in [Permissions](permissions.md).

## Requirements

| Agent | Install | Auth |
|---|---|---|
| Claude Code | Claude Code CLI (`claude`) | Your Claude subscription (log in once in a terminal) or an Anthropic API key |
| Codex | Codex CLI (`codex`) | Your ChatGPT/Codex plan (log in once) or an OpenAI API key |
| Home agent | Built in | Uses your primary brain |

If the CLIs are not on your `PATH`, set `claudePath` / `codexPath`. Subscription rate limits apply; when you hit one, Jarvis tells you and never switches to a paid API by itself.

## Logs and history

Each session keeps a raw event log at `logs/sessions/<id>.ndjson` in the data directory, reachable from the session card (**Log**). Results returned by agents are treated as untrusted data: they can inform answers, but cannot trigger new actions on their own.

## Calling Jarvis from your agents

The other direction works too: Claude Code and Codex can call Jarvis to speak, ask you a question, or start a task.

```bash
claude mcp add jarvis -- node /path/to/jarvis-mcp.mjs
```

```toml
# ~/.codex/config.toml
[mcp_servers.jarvis]
command = "node"
args = ["/path/to/jarvis-mcp.mjs"]
tool_timeout_sec = 620
```

Settings › Integrations › **Copy command** gives the full path of `jarvis-mcp.mjs` for your OS (Node.js 20+ required). Tools are listed in the [MCP tools reference](../reference/mcp-tools.md).
