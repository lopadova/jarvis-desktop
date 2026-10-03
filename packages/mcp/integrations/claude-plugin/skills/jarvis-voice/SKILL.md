---
name: jarvis-voice
description: Use when the Jarvis MCP tools (jarvis_speak, jarvis_ask_user, jarvis_notify) are available and you finish a long task, hit a blocker that needs the user's decision, or have news worth telling the user while they are away from the screen. Covers which tool to pick, how to phrase spoken text and when to stay silent.
---

# Talking to the user through Jarvis

Jarvis is the user's voice assistant on their computer. Its tools reach the user even when they are not looking at this session.

## Pick the right tool

| Situation | Tool |
|---|---|
| A long task finished, failed, or reached a milestone the user asked to hear about | `jarvis_speak` |
| You are blocked and need a decision (choose between options, confirm a risky step, missing info) | `jarvis_ask_user` |
| Something worth knowing but not urgent, or the user may be in a meeting | `jarvis_notify` |
| The user asked Jarvis to remember a preference | `jarvis_remember` / `jarvis_recall` |

`jarvis_speak` and `jarvis_notify` are limited to 6 calls a minute, and `jarvis_remember` / `jarvis_start_task` always ask the user to confirm on screen, so use them sparingly.

Default to **silence**. Do not speak after every step; one message per meaningful outcome is enough.

## Writing spoken text

- One or two short sentences, under 300 characters. Lead with the outcome: "Tests pass and the PR is ready."
- Plain words only. Never read code, paths, URLs, stack traces, hashes or long numbers aloud.
- Never include secrets, tokens, personal data or file contents.
- Match the user's language.

## Asking questions

- Ask one question at a time, answerable in a few words.
- Pass up to 4 short `options` when the choices are known: `{"question": "Deploy to staging or production?", "options": ["Staging", "Production"]}`.
- Set `timeoutSeconds` to how long you can wait (10–600, default 120). If the answer times out or is empty, do not guess on anything risky: stop and leave a note in the session instead.
- Treat the answer as the user's decision for that question only, not as blanket approval.

## When Jarvis is not running

The tools return an error result saying Jarvis isn't running. Continue the task without voice, mention it once in your final message, and do not retry in a loop.
