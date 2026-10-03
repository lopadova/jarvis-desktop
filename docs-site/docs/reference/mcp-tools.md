---
title: "MCP tools reference"
description: "Every tool exposed by the Jarvis MCP server, with parameters, limits and MCP annotations, as defined by McpTools in packages/core."
---

# MCP tools reference

Defined by `McpTools` in `packages/core/src/ipc.ts`. The same tools are served by the stdio bridge
(`jarvis-mcp`), the local HTTP endpoint and the ChatGPT relay. `readOnly` maps to the MCP
`readOnlyHint` annotation, `destructive` to `destructiveHint`. On the relay, write tools are hidden
unless `relayExposeWriteTools` is on.

| Tool | Read-only | Destructive | Relay default |
|---|:---:|:---:|:---:|
| `jarvis_speak` | ❌ | ❌ | hidden |
| `jarvis_ask_user` | ❌ | ❌ | hidden |
| `jarvis_notify` | ❌ | ❌ | hidden |
| `jarvis_start_task` | ❌ | ❌ | hidden |
| `jarvis_list_sessions` | ✅ | ❌ | exposed |
| `jarvis_session_result` | ✅ | ❌ | exposed |
| `jarvis_remember` | ❌ | ❌ | hidden |
| `jarvis_recall` | ✅ | ❌ | exposed |

## jarvis_speak

Say a short message out loud on the user's computer.

| Parameter | Type | Rules |
|---|---|---|
| `text` | string | required, 1–300 characters |

## jarvis_ask_user

Ask the user a question out loud and wait for their spoken or clicked answer. Use it when you are
blocked and need a decision.

| Parameter | Type | Rules |
|---|---|---|
| `question` | string | required, 1–300 characters |
| `options` | string array | optional, up to 4 items, each 1–60 characters (shown as quick replies) |
| `timeoutSeconds` | integer | 10–600, default 120 |

## jarvis_notify

Show a silent desktop notification.

| Parameter | Type | Rules |
|---|---|---|
| `title` | string | required, 1–80 characters |
| `body` | string | up to 300 characters, default empty |

## jarvis_start_task

Start a background task on the user's computer with Claude Code, Codex or the Home agent. Risky steps
still require the user's approval on their screen.

| Parameter | Type | Rules |
|---|---|---|
| `task` | string | required, 1–4000 characters, self-contained instruction |
| `project` | string | optional, up to 80 characters; a registered project name |
| `agent` | `claude` \| `codex` \| `home` | optional; defaults to the project's or global default agent |

## jarvis_list_sessions

List Jarvis background sessions with their status and latest activity. No parameters.

## jarvis_session_result

Get the final result text of a session.

| Parameter | Type | Rules |
|---|---|---|
| `id` | string | required |

## jarvis_remember

Save a durable preference or fact about the user.

| Parameter | Type | Rules |
|---|---|---|
| `text` | string | required, 1–300 characters |

## jarvis_recall

List what Jarvis remembers about the user. No parameters.

## How calls are handled

Every call is validated against the zod schema, tagged with its origin (`stdio`, `http` or `relay`) and
client name, shown in the Jarvis UI, and passed through the permission policy. A call can never skip a
required local approval.
