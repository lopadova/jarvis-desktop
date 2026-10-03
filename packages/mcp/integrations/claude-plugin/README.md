# Jarvis plugin for Claude Code and Cowork

Adds the Jarvis MCP server (`jarvis_speak`, `jarvis_ask_user`, `jarvis_notify`, …) and the `jarvis-voice` skill, which teaches Claude when to talk to you and when to stay quiet.

The Jarvis desktop app must be running. The MCP server only talks to it over loopback.

## Install from GitHub

```text
/plugin marketplace add lopadova/jarvis-desktop
/plugin install jarvis@jarvis-desktop
```

The marketplace file is `.claude-plugin/marketplace.json` at the repository root.

## Variant: use a local build instead of npx

By default `.mcp.json` starts the server with `npx -y @jarvis/mcp`. To use a bundle you built yourself (`pnpm --filter @jarvis/mcp build`), or the copy shipped inside the app, point `.mcp.json` at the file:

```json
{
  "mcpServers": {
    "jarvis": {
      "command": "node",
      "args": ["/absolute/path/to/jarvis-desktop/packages/mcp/dist/jarvis-mcp.mjs"]
    }
  }
}
```

If `jarvis-mcp` is on your `PATH` (`npm i -g @jarvis/mcp`), use `"command": "jarvis-mcp"` with no arguments.

On Windows, if the server fails to start through `npx`, use `"command": "cmd", "args": ["/c", "npx", "-y", "@jarvis/mcp"]`.

To try the plugin without installing it:

```bash
claude --plugin-dir ./packages/mcp/integrations/claude-plugin
```

## Without the plugin

```bash
claude mcp add jarvis -- jarvis-mcp
```
