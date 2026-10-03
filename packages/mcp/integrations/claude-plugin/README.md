# Jarvis plugin for Claude Code and Cowork

Adds the Jarvis MCP server (`jarvis_speak`, `jarvis_ask_user`, `jarvis_notify`, …) and the `jarvis-voice` skill, which teaches Claude when to talk to you and when to stay quiet.

The Jarvis desktop app must be running. The MCP server only talks to it over loopback.

## Install from GitHub

```text
/plugin marketplace add lopadova/jarvis-desktop
/plugin install jarvis@jarvis-desktop
```

The marketplace file is `.claude-plugin/marketplace.json` at the repository root.

## How the server runs

`.mcp.json` runs the server bundled **inside** the plugin:

```json
{ "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/server/jarvis-mcp.mjs"] }
```

Nothing is downloaded from npm when the server starts, so a third party can't swap the code you run. `server/jarvis-mcp.mjs` is a build artefact that is committed on purpose, because plugins installed from a GitHub marketplace are used exactly as they are in the repository. `pnpm --filter @jarvis/mcp build` regenerates it, and `test/bundle.test.ts` fails in CI if the committed copy doesn't match the sources.

Node.js 20 or later must be on your `PATH`.

## Variant: point at another local build

To run a bundle from somewhere else, such as a checkout you build yourself or the copy in a release zip, edit `.mcp.json`:

```json
{
  "mcpServers": {
    "jarvis": {
      "command": "node",
      "args": ["/absolute/path/to/jarvis-mcp.mjs"]
    }
  }
}
```

To try the plugin from a checkout without installing it:

```bash
claude --plugin-dir ./packages/mcp/integrations/claude-plugin
```

## Without the plugin

```bash
claude mcp add jarvis -- node /absolute/path/to/jarvis-mcp.mjs
```
