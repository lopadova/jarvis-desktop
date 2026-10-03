# FAQ

## General

**Is Jarvis free?**
Yes. Jarvis is open source under the MIT license. You use it with AI you already have (a ChatGPT plan, Claude Code, Codex), with your own API keys, or with free local models.

**Which operating systems are supported?**
macOS 12+ (Apple Silicon and Intel), Windows 10/11 (x64) and Linux x86_64 (AppImage, .deb, .rpm).

**Which languages does it speak?**
English and Italian, for both the interface and voice. More languages are on the [roadmap](../../ROADMAP.md).

**Is there a mobile app?**
Not yet. A **companion** app (push-to-talk, your sessions, remote approvals, notifications) is planned — see the [roadmap](../../ROADMAP.md). A full always-listening phone assistant isn't possible because mobile OSes restrict background microphone use.

**Why does my OS warn me when I install it?**
v0.1 installers are not code-signed (signing certificates cost money every year). See [Install](install.md).

## Cost and accounts

**Do I need an API key?**
No. You can sign in with your ChatGPT Plus/Pro plan, or use Claude Code / Codex with your subscription, or run a local model. API keys are optional.

**Can Jarvis run up a bill?**
Not by surprise. With Sign in with ChatGPT you set a weekly cap for Jarvis. When a plan limit is reached, Jarvis tells you and **never** switches to a pay-per-use API by itself. If you add an API key, set a spending limit in the provider console as well.

**Does my ChatGPT plan cover the voice too?**
No. Plan usage covers text only. Voices and transcription are separate — and you can use free local ones. See [Voices](voices.md).

**Which brain should I choose?**
Have ChatGPT Plus/Pro? Start with Sign in with ChatGPT. Use Claude daily? Claude Code. Want total privacy? Local. Details in [Brains](brains.md).

## Privacy and safety

**Is it always listening?**
The wake-word detector listens on your computer only, and nothing is recorded or sent while it waits. A visible indicator shows when the mic is live. See [Microphone](microphone.md).

**Can someone on TV make Jarvis delete my files?**
High-risk actions (deleting, `sudo`, `git push`, sending data…) always need a **click** on your screen, never just a spoken "yes". New projects start in Safe mode. See [Permissions](permissions.md).

**Can a malicious email or web page take control?**
Content that agents read is treated as data, not instructions; actions must be grounded in what you actually said. See the [security model](../security-model.md).

**Where are my data and keys stored?**
Data in one local folder; keys only in your OS keyring. See [Memory & privacy](memory-privacy.md).

**Does Jarvis collect telemetry?**
No.

## Integrations

**Can I use Jarvis inside Claude Desktop or Cowork?**
Yes, with the `.mcpb` extension or the plugin. See [Claude Desktop & Cowork](cowork-claude-desktop.md).

**And inside ChatGPT?**
Yes, through a free relay you deploy (Cloudflare recommended). Connector availability depends on your ChatGPT plan — check the current OpenAI docs. See [ChatGPT](chatgpt.md).

**Can Claude Code or Codex talk to me through Jarvis?**
Yes: add Jarvis as an MCP server (`node /path/to/jarvis-mcp.mjs`) and they can speak, ask you questions and notify you. See the [MCP tools reference](../reference/mcp-tools.md).

## Developers

**What is it built with?**
A Tauri 2 (Rust) shell with a React UI and a TypeScript sidecar compiled with Bun. See [Architecture](../architecture/overview.md).

**How do I contribute?**
Start with [Development setup](../contributing/dev-setup.md) and [CONTRIBUTING.md](../../CONTRIBUTING.md).
