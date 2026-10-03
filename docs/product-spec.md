# Jarvis Desktop — Product Specification

Status: **Draft v0.1** · Owner: @lopadova · Last update: 2026-10-03

## 1. Vision

A voice-first personal assistant for **macOS, Windows and Linux** that anyone can install in minutes and that works with the AI subscriptions people already have. Say *"Jarvis"*, speak naturally, and Jarvis either answers right away or delegates the work to a background agent, narrates progress, asks before doing anything risky, and reports back.

## 2. Users

| Persona | Needs | Typical requests |
|---|---|---|
| **Everyday user** ("home") | No terminal, no API keys, privacy, quick wins | briefing, timers/reminders, summarise/translate clipboard, dictation, "what's on my screen", find a file, weather, shopping list |
| **Knowledge worker** | Mail, calendar, documents via their MCP connectors | "summarise unread mail", "prepare my next meeting", "reply to Giulia" |
| **Developer** | Drive Claude Code / Codex hands-free across projects | "in project *shop* add a footer", "how's it going?", "continue with Codex", approvals by voice |
| **Power user** | Use Jarvis from Claude Cowork / ChatGPT / agents | MCP tools: `jarvis_speak`, `jarvis_ask_user`, `jarvis_start_task` |

## 3. Core concepts

- **Brain** — the LLM that understands each utterance and decides the action (router). Pluggable: ChatGPT plan (Sign in with ChatGPT), Claude Code, Codex CLI, Anthropic/OpenAI API key, local (Ollama / OpenAI-compatible).
- **Agent (worker)** — does long or tool-heavy work in the background: Claude Code (Agent SDK), Codex (Codex SDK / app-server), or the built-in **Home agent** (Responses API loop + curated tools + the user's MCP servers).
- **Session** — one agent run (with follow-ups/resume). Has status, live activity, result, log.
- **Project** — a folder with a name, aliases, default agent and **permission level** (`safe` default, `trusted`, `full-auto`). Non-project work runs in the **General workspace**.
- **Memory** — durable facts the user asked Jarvis to remember; shown and editable in the UI.
- **Voice** — STT (wake word, VAD, transcription) and TTS (streaming, with expressive cues).

## 4. Interaction model

### 4.1 Activation
- Wake word **"Jarvis"** (on-device keyword spotting; nothing leaves the computer until a command is captured).
- **Push-to-talk** global shortcut (press = listen, release = send). Default `⌥Space` (mac) / `Alt+Space`-free alternative on Windows (`Ctrl+Alt+Space`), configurable.
- **Double clap** (optional, only when idle).
- **Typing** in the Home composer or clicking a suggestion chip.
- **Conversation mode**: after Jarvis replies it keeps listening for N seconds (default 6) without the wake word.

### 4.2 Turn pipeline
1. Capture → VAD end-of-speech (≈1.2 s silence, max 30 s) → transcript.
2. **Fast path** (no LLM): stop/cancel, status, repeat, timers, alarms, reminders, volume, private mode, open settings.
3. **Brain** call with context: projects, sessions (results as *untrusted data*), memory, recent turns, time/locale. Output validated against the `RouterAction` schema (§5).
4. **Policy check** (§ security-model) → execute → speak reply (streamed TTS) → record turn.

### 4.3 Router actions
`answer` (reply now, optionally from a finished session's result) · `spawn` (new session) · `followup` (continue a session) · `cancel` · `status` · `open` (folder/terminal/editor/result) · `clarify` (one question + quick replies) · `create_project` · `reminder` · `remember` / `forget` (side-effects allowed on any action).

### 4.4 Progress & completion
- First spoken progress after 20 s, then at most every 45 s per session; one session speaks at a time; muted during Focus/DND (via supported OS APIs) or when the user is talking.
- On completion: short spoken summary (≤ 25 words), auto-open viewable results (HTML file, localhost URL) if enabled, desktop notification.

### 4.5 Approvals
Agents request permission through Jarvis (Claude `canUseTool`, Codex approvals, Home-agent tool gate). The pill shows an **Approval Card**; low-risk can be approved by voice ("yes"/"sì"), **high-risk requires a click**. Decisions: allow once / deny / always allow in this project (not for high risk). Timeout → deny.

## 5. RouterAction schema (contract)

```ts
type RouterAction = {
  action: 'answer' | 'spawn' | 'followup' | 'cancel' | 'status' | 'open' | 'clarify' | 'create_project' | 'reminder';
  speak: string;                       // what Jarvis says (may contain neutral cues)
  agent?: 'claude' | 'codex' | 'home' | null;
  project?: string | null;             // must match a registered project name, or null
  sessionId?: string | null;
  task?: string | null;                // self-contained instruction for the agent
  coding?: boolean | null;             // routes to the stronger coding model
  quickReplies?: string[] | null;      // for clarify
  reminder?: { text: string; dueAt: string } | null; // ISO 8601
  remember?: string | null;
  forget?: { memoryId: string } | null; // by id only (never by fuzzy phrase)
};
```

## 6. Providers matrix (v0.1 target)

| Capability | Providers |
|---|---|
| Brain | ChatGPT plan (SIWC) ⭐, Claude Code CLI, Codex CLI, Anthropic API, OpenAI API, Ollama / OpenAI-compatible |
| Agents | Claude Agent SDK, Codex SDK, Home agent |
| TTS | ElevenLabs, Fish Audio, OpenAI (API key), Kokoro / Piper (local), OS voice |
| STT | Local: sherpa-onnx KWS + Silero VAD + whisper.cpp · Cloud: OpenAI transcribe, ElevenLabs Scribe |
| Interop | MCP server (stdio + HTTP), `.mcpb` extension, Cowork/Claude Code plugin, Cloudflare relay for ChatGPT |

Graceful degradation: every provider is optional; the app always starts and explains what is missing.

## 7. Everyday features (v0.1 scope)
Morning briefing · timers/alarms/reminders (local) · clipboard summarise/translate/fix · dictation into the active app · "what's on my screen" (opt-in screenshot + vision) · find files · web research (via agent) · shopping list · memory management · private/local mode · usage meter · history with search · EN/IT UI. All surfaced as **suggestion chips** on the Home screen (see design brief §9).

## 8. Non-functional requirements
- Idle footprint: < 80 MB RAM total (shell + sidecar), < 2 % CPU on a modern laptop with wake word on.
- Wake-to-listening feedback < 150 ms; fast-path reply < 300 ms; first audio of a brain reply < 1.5 s (cloud brain + streaming TTS, good network).
- Startup < 2 s to tray.
- All persistent state in one SQLite DB in the OS app-data dir; secrets only in the OS keyring.
- Crash-safe: orphaned agent processes are reaped at startup (verified by process start time).
- i18n: English + Italian at launch.

## 9. Out of scope for v0.1 (see ROADMAP)
Mobile companion app, speaker verification, paid code signing/notarisation, third-party plugin marketplace, advanced scheduled routines.
