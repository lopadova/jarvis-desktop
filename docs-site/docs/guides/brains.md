---
title: "Brains & subscriptions"
description: "Connect Jarvis to your ChatGPT plan, Claude Code, Codex, an API key or a local model — with the honest limits of each."
---

# Brains & subscriptions

The **brain** is the AI model that understands what you said and decides what to do: answer now, start a
background session, follow up on one, ask you a question, set a reminder, remember something. Every
utterance that is not an instant command goes to your **primary brain**.

::: callout tip "The golden rule: no surprise bills" icon:badge-check
Jarvis **never** switches from a subscription to a pay-per-use API on its own. When a plan limit is
reached it tells you — *"Your ChatGPT weekly allowance for Jarvis is used up. I won't switch to paid API
on my own"* — and you choose what to do. This is security rule **R10**, covered by automated tests.
:::

## Compare at a glance

| Brain | You need | Cost model | Best for | Honest limits |
|---|---|---|---|---|
| **ChatGPT plan** ⭐ | ChatGPT Plus or Pro | Your plan allowance, weekly cap you set | Most people | Text only (no audio); cap per app |
| **Claude Code** | Claude subscription + Claude Code installed | Your Claude plan limits | Developers | Subscription rate limits apply |
| **Codex** | ChatGPT account + Codex CLI | Your plan's Codex allowance | Developers | Plan limits apply |
| **Anthropic API** | API key | Pay per use | Predictable control | You pay per token |
| **OpenAI API** | API key | Pay per use | Also enables OpenAI voice and transcription | You pay per token |
| **Local** | Ollama or any OpenAI-compatible server | Free, your hardware | Privacy, offline | Needs a capable computer; smaller models are less clever |

![Onboarding: choose your brain](/assets/screenshots/onboarding-brain-dark.png)

You can connect several and choose a **primary** one in **Settings › Brain & accounts**, from the
composer's provider switcher, or by asking.

## ChatGPT plan — Sign in with ChatGPT

::: steps
1. **Settings › Brain & accounts › Continue with ChatGPT** (or the wizard card).
2. Your system browser opens OpenAI's sign-in. Approve **Jarvis Desktop**.
3. Set a **weekly cap** for Jarvis. You can change or revoke it in your ChatGPT account at any time.
4. The account row shows your plan and a usage bar (warning at 80 %, red at 100 %).
:::

How it works, in brief: a standard OAuth flow (Authorization Code + PKCE) with a loopback redirect;
tokens are stored in your OS keyring and refreshed automatically. Jarvis only uses the Responses API
with your plan, without storing conversations on OpenAI's side (`store: false`).

::: callout warning "What the plan covers — and what it doesn't" icon:triangle-alert
- **Covered:** text understanding and replies (the Responses API).
- **Not covered:** audio — text-to-speech, transcription, realtime voice. Use a separate voice provider:
  local/system voices are free; ElevenLabs, Fish Audio or OpenAI API need their own account.
- **Cap reached:** Jarvis stops using ChatGPT until the cap resets or you raise it, and offers to switch
  to another brain you already connected. It never moves you to a paid API by itself.
- Availability and allowances are decided by OpenAI and can change — check current OpenAI docs.
:::

## Claude Code

Install Claude Code and sign in once:

```bash
npm install -g @anthropic-ai/claude-code
claude
```

Jarvis detects it (found / not found / needs login). If it lives in an unusual place, set its path in
**Settings › Agents & projects** (`claudePath`). Claude Code then works both as a brain and as the
default agent for project work. Usage counts against your Claude subscription's limits; when you hit
them, Jarvis tells you and waits.

## Codex

```bash
npm install -g @openai/codex
codex login
```

Choose **Codex** as brain or agent. Custom location: `codexPath`. Say *"do the same with Codex"* to run
the last task again with Codex.

::: callout warning "Codex as a brain is slow" icon:clock
Every brain call boots a full Codex agent: 40–80 seconds per request with a ChatGPT login. Prefer the
ChatGPT plan, Claude Code or an API key as the *primary* brain, and use Codex as an **agent** for coding tasks.
:::

## API keys

Paste an **Anthropic** or **OpenAI** key in **Settings › Brain & accounts**. Keys go straight to your
OS keyring (Keychain, Windows Credential Manager, Secret Service) — never to files, logs or the command
line. Default models are small and fast (`claude-haiku-4-5`, `gpt-5-mini`) and can be changed
(`apiModels`). For heavy coding tasks Jarvis can route to a stronger model (`codingModel`).

## Local — Ollama or OpenAI-compatible

```bash
ollama pull llama3.2
```

Default endpoint `http://127.0.0.1:11434/v1`, model `llama3.2` (`localBrain`). Any server that speaks
the OpenAI chat API works (LM Studio, llama.cpp server, vLLM…). Combine with a local voice and local
Whisper for a fully offline Jarvis — or just say *"Jarvis, switch to local mode"*.

::: callout info "Choosing a local model" icon:cpu
Routing needs reliable structured output. 7–8B instruction models work for everyday commands; bigger
models make fewer mistakes on complex requests. Jarvis validates every decision and asks you to repeat
when it cannot parse one, rather than guessing.
:::

## Brain vs agent

The **brain** decides; an **agent** does long work. The brain can be ChatGPT while the agent is Claude
Code — each uses its own subscription. See [Agents, projects & sessions](/developers/agents).
