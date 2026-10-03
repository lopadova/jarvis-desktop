# Brains: which AI understands you

The **brain** is the language model that reads each request and decides what to do: answer right away, start a background session, ask a clarifying question, set a reminder, and so on. Jarvis does not ship its own model — you connect one (or several) that you already have.

You can connect more than one brain and mark one as **primary** in Settings › Brain & accounts (setting `primaryBrain`). The Home composer also has a quick brain switcher.

Simple commands — stop, timers, alarms, reminders, time, date, private mode — **never** use a brain: they are recognised on your computer instantly and work offline ([voice commands](../reference/voice-commands.md)).

## At a glance

| Brain | You need | Cost model | Privacy |
|---|---|---|---|
| **ChatGPT plan** (Sign in with ChatGPT) ⭐ | ChatGPT Plus or Pro | Uses your plan allowance, capped weekly by you | Text goes to OpenAI |
| **Claude Code** | Claude Code CLI, logged in with your Claude subscription | Uses your subscription limits | Text goes to Anthropic |
| **Codex** | Codex CLI, logged in | Uses your ChatGPT/Codex plan limits | Text goes to OpenAI |
| **API key** | Anthropic or OpenAI API key | Pay per use, billed by the provider | Text goes to the provider |
| **Local** | Ollama (or any OpenAI-compatible server) | Free; your hardware | Nothing leaves your computer |

> **Jarvis never switches to a paid API on its own.** If your subscription allowance runs out, Jarvis tells you and lets you choose another brain. (Security rule R10.)

## ChatGPT plan — Sign in with ChatGPT

Plus and Pro users can let Jarvis use their plan allowance instead of paying per API call.

1. Settings › Brain & accounts › **Continue with ChatGPT** (also in onboarding).
2. Your browser opens the official OpenAI sign-in page. Approve Jarvis.
3. On the consent screen, set a **weekly cap** for Jarvis — the maximum share of your plan it may use.
4. Back in Jarvis you'll see your plan and a **usage meter** ("ChatGPT plan: 12 % of weekly cap used").

What to know:
- Plan usage covers **text only** (the Responses API). It does **not** cover audio — text-to-speech, speech-to-text or realtime voice — so your voice providers are configured separately ([Voices](voices.md), [Microphone](microphone.md)).
- When you reach your cap, Jarvis says so, shows "Weekly cap reached" and stops using ChatGPT until the cap resets or you raise it. It will not fall back to an API key automatically.
- Tokens are stored in your OS keyring and refreshed automatically; you stay signed in for weeks. **Disconnect** removes them.
- The model list comes from your account. Leave `chatgptModel` empty to use the default.
- Availability, caps and supported features are set by OpenAI and can change — check the current OpenAI documentation for Sign in with ChatGPT.

## Claude Code

Uses your Claude subscription (Pro/Max) through the official Claude Code CLI.

1. Install Claude Code and log in once in a terminal: run `claude` and follow the login.
2. In Jarvis, Settings › Brain & accounts › **Use Claude Code**. Jarvis detects the CLI (found / not found / needs login). If it is installed somewhere unusual, set its path in `claudePath`.

Claude Code is also an **agent** — it can do real work in your projects ([Developers](developers-agents.md)). Brain usage and agent work share your subscription's rate limits; if you hit them, Jarvis tells you and waits or offers another brain.

## Codex

Uses the Codex CLI with your ChatGPT/Codex plan.

1. Install the Codex CLI and log in once (`codex` in a terminal).
2. Settings › Brain & accounts › **Codex**. Set `codexPath` if it is not on your `PATH`.

Like Claude Code, Codex is also available as an agent. Plan rate limits apply.

## API keys (Anthropic, OpenAI)

Pay-per-use, with no subscription needed.

1. Create a key in the provider's console.
2. Settings › Brain & accounts › **Use an API key** › paste it. It is stored only in the OS keyring, never in settings files or logs.
3. Default models: `claude-haiku-4-5` (Anthropic) and `gpt-5-mini` (OpenAI) — fast and inexpensive for routing. Change them in `apiModels`.

Tip: set a spending limit in the provider's console. An OpenAI API key also unlocks OpenAI text-to-speech and cloud transcription.

## Local (Ollama or OpenAI-compatible)

Fully private: nothing leaves your computer.

1. Install [Ollama](https://ollama.com) and pull a model:
   ```bash
   ollama pull llama3.2
   ```
2. Settings › Brain & accounts › **Run locally**. Defaults: base URL `http://127.0.0.1:11434/v1`, model `llama3.2` (setting `localBrain`). Any OpenAI-compatible server works (LM Studio, llama.cpp server, vLLM…).

Be realistic: small local models are good at simple requests but weaker at multi-step reasoning, and speed depends on your hardware. A recent laptop with 16 GB RAM handles 3–8B models comfortably.

**Private mode** ("Jarvis, switch to local mode") forces the local brain, local transcription and a local voice. A green ring around the orb shows that nothing leaves the computer. See [Memory & privacy](memory-privacy.md).

## The coding model

When a request is about code, Jarvis routes it to a stronger model for the agent (`codingModel`, default `claude-opus-5-5`). The brain that understands your utterance can stay fast and cheap.

## Troubleshooting

- *"I don't have a brain connected yet"* → connect one in Settings › Brain & accounts.
- *"I need you to sign in to … again"* → the login expired; reconnect.
- *"Your weekly allowance for Jarvis is used up"* → raise the cap in your ChatGPT settings, wait for the reset, or pick another brain.

More in [Troubleshooting](troubleshooting.md).
