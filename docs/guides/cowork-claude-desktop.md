# Use Jarvis from Claude Desktop and Cowork

Jarvis exposes an MCP server, so Claude (in Claude Desktop, Cowork or Claude Code) can **speak to you out loud, ask you a question and wait for your answer, notify you, start background tasks on your computer, and read or save your preferences**.

Typical uses:
- *"When you're done, tell me out loud."* → `jarvis_speak`
- A long Cowork task that hits a decision → `jarvis_ask_user` asks you by voice and waits.
- *"Have Jarvis run the test suite in project shop."* → `jarvis_start_task`

All tools are listed in the [MCP tools reference](../reference/mcp-tools.md).

> **Jarvis must be running** on the same computer. The extension talks to the running app through a local connection file; if Jarvis is closed, tools return "Jarvis isn't running on this computer".

## Option 1 — Claude Desktop extension (`.mcpb`, one click)

1. Download `jarvis.mcpb` from the [latest release](https://github.com/lopadova/jarvis-desktop/releases/latest). (The **Install extension** button in Settings › Integrations is marked "coming soon" in v0.1.)
2. Double-click the file, or drag it into Claude Desktop › **Settings › Extensions**.
3. Review the permissions and click **Install**.
4. Ask Claude: *"Use Jarvis to say hello."* You should hear it.

## Option 2 — Cowork / Claude Code plugin (skill + MCP)

The plugin bundles the MCP server with a skill that teaches Claude when to use Jarvis (e.g. announce completion, ask before blocking).

In Claude Code (or Cowork, where plugins are supported):

```text
/plugin marketplace add lopadova/jarvis-desktop
/plugin install jarvis@jarvis-desktop
```

## Option 3 — Manual MCP configuration

Claude Code:

```bash
claude mcp add jarvis -- node /path/to/jarvis-mcp.mjs
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "jarvis": { "command": "node", "args": ["/path/to/jarvis-mcp.mjs"] }
  }
}
```

Replace `/path/to/jarvis-mcp.mjs` with the real path of the file: unzip the `jarvis-mcp-bundle.zip` release asset (it contains `dist/jarvis-mcp.mjs`) somewhere permanent, or build it with `pnpm --filter @jarvis/mcp build`. There is no `jarvis-mcp` command on your `PATH`. It needs Node.js 20 or later.

## Safety

- Calls from Claude go through the same permission policy as everything else. `jarvis_start_task` starts a normal session: risky steps still need **your** approval on screen.
- Every call is validated and shown in the Jarvis UI.
- The local bridge uses a token limited to MCP tools; it cannot change settings or read secrets.
- `jarvis_start_task` and `jarvis_remember` always ask you on screen before doing anything, whoever calls them.

## Troubleshooting

- **Tools don't appear:** restart Claude Desktop after installing; check Settings › Extensions shows Jarvis enabled.
- **"Jarvis isn't running on this computer":** start Jarvis (tray icon) and retry.
- **No sound:** check Jarvis › Settings › Voice and that `speakReplies` is on.

More in [Troubleshooting](troubleshooting.md).
