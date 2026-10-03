# @jarvis/mcp

MCP server for [Jarvis Desktop](https://github.com/lopadova/jarvis-desktop). It lets Claude Desktop, Claude Code, Cowork, Codex and other MCP clients talk to you through Jarvis: speak short updates, ask you a question out loud and wait for the answer, show notifications, start background tasks and read Jarvis memory.

The server is a thin bridge. It reads `run/agent-host.json` from the Jarvis data directory and connects to the running app over a loopback WebSocket as the `mcp` role. Every call goes through the app's normal permission policy and is shown in its UI. If the app isn't running, tools return the error "Jarvis isn't running on this computer — open the Jarvis app".

## Tools

| Tool | Read-only | What it does |
|---|---|---|
| `jarvis_speak` | no | Say a short message out loud (≤ 300 chars) |
| `jarvis_ask_user` | no | Ask a question out loud and wait for the answer (up to 600 s) |
| `jarvis_notify` | no | Silent desktop notification |
| `jarvis_start_task` | no | Start a background task (Claude Code, Codex or the Home agent) |
| `jarvis_list_sessions` | yes | List background sessions |
| `jarvis_session_result` | yes | Final result of a session |
| `jarvis_remember` | no | Save a preference or fact |
| `jarvis_recall` | yes | List remembered facts |

Names, descriptions and argument schemas come from `@jarvis/core` (`McpTools`). JSON Schemas are generated with zod 4 `z.toJSONSchema`.

## Install in your client

| Client | How |
|---|---|
| Claude Desktop | Double-click `jarvis.mcpb` (from the release, or `pnpm --filter @jarvis/mcp pack:mcpb`) |
| Claude Code / Cowork | `/plugin marketplace add lopadova/jarvis-desktop`, then `/plugin install jarvis@jarvis-desktop`. Or run `claude mcp add jarvis -- jarvis-mcp` |
| Codex | Copy [`integrations/codex/config.toml.example`](integrations/codex/config.toml.example) into `~/.codex/config.toml` |
| Anything else (stdio) | Command `jarvis-mcp`, or `npx -y @jarvis/mcp`, or `node dist/jarvis-mcp.mjs` |
| HTTP clients / Cloudflare Tunnel | `JARVIS_MCP_HTTP_TOKEN=<secret> jarvis-mcp --http --port 8765` serves `http://127.0.0.1:8765/mcp`. See [`docs/guides/chatgpt-tunnel.md`](../../docs/guides/chatgpt-tunnel.md) |

## Library API

```ts
import { createHttpMcpServer, createJarvisMcpServer, createSidecarForwarder, SidecarClient } from '@jarvis/mcp';

// Streamable HTTP on 127.0.0.1 with bearer auth and Origin checks.
// `forward` decides how a call reaches Jarvis (here: over the sidecar socket with origin 'http').
const http = await createHttpMcpServer({ port: 8765, bearerToken, forward });
```

- `toolDefinitions()` (also exported from `@jarvis/mcp/tools`) returns the MCP tool list with annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint: false`, `title`).
- Timeouts: 600 s for `jarvis_ask_user`, 30 s for the other tools.

## Build

```bash
pnpm --filter @jarvis/mcp build       # dist/jarvis-mcp.mjs: one file, all dependencies bundled, Node ≥ 20
pnpm --filter @jarvis/mcp pack:mcpb   # dist/jarvis.mcpb (Claude Desktop extension, MCPB manifest 0.3)
pnpm --filter @jarvis/mcp gen:relay   # regenerate the relay's tool catalogue after changing McpTools
```
