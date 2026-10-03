# Permissions and approvals

Jarvis can start agents that edit files and run commands. That is powerful, so it is **safe by default**: agents ask Jarvis before doing anything risky, and Jarvis asks you.

## Permission levels

Every project — and the General workspace for non-project work — has a level. Change it in Settings › Agents & projects.

| Level | What runs without asking | What still asks |
|---|---|---|
| **Safe** (default) | Reading, and editing files **inside the project folder** | Shell commands, network, deletions, files outside the project, MCP write tools |
| **Trusted** | The above, plus low-risk actions and shell commands on your **allowlist** (e.g. `pnpm test`) | Everything medium or high risk not on the allowlist |
| **Full auto** | Everything except high risk | **High-risk actions always ask** |

*Full auto* is an explicit per-project opt-in behind a confirmation dialog. Even in Full auto, nothing high-risk happens silently.

Allowlist entries are command prefixes: `pnpm test` allows `pnpm test` and `pnpm test --watch`, but never a compound command (`pnpm test && rm -rf x`, pipes, redirects, `$(…)`, multiple lines).

## Risk tiers

Each request is classified **low**, **medium** or **high**. Anything not recognised as harmless is at least medium.

| Risk | Examples |
|---|---|
| **Low** | Read-only commands: `ls`, `cat`, `grep`, `rg`, `git status`, `git log`, `git diff`; writing a file inside the project; MCP tools marked read-only |
| **Medium** | Most other commands — including `npm test` / `pnpm build`, since package scripts can run anything; deleting a file inside the project; network reads; MCP tools without hints |
| **High** | `rm -rf`, `sudo`, `git push`, `git reset --hard`, `git clean -f`, `npm/pnpm/cargo publish`, `curl … \| sh`, `shutdown`, `chmod -R`, `kubectl delete`, `terraform apply/destroy`, cloud `delete/destroy`; anything touching credentials (`.ssh`, `.aws`, `.gnupg`, `.env`, `*.pem`, `*.key`, keychains) or system folders; deleting or writing outside the project; network requests that send data (POST/PUT/PATCH/DELETE); destructive MCP tools; network commands chained with others |

## Approving

When an agent needs permission, the listening pill expands into an **approval card** showing what it wants to do (the command, path, URL or tool), where, which agent and which project.

| Decision | Low / medium risk | High risk |
|---|---|---|
| Allow once | Click, or say **"yes"** / *"sì"* | **Click only** |
| Deny | Click, or say **"no"** | Click (Deny is focused by default) |
| Always allow in this project | Click | Not offered |
| No answer | Denied when the request times out | Denied when the request times out |

Why click-only for high risk? A TV, a video or another person in the room could say "yes". Voice is convenient for small things; destructive things need your hand.

Recognised voice answers are listed in [Voice commands](../reference/voice-commands.md#approval-answers).

## Where approvals come from

- **Claude Code** — through the Agent SDK permission callback.
- **Codex** — through its approval requests.
- **Home agent** — through its own tool gate.
- **Calls from other apps** (Claude Desktop, ChatGPT via the relay) go through the same checks. A remote call can never skip a local approval.

Every decision is recorded, so the approval history doubles as an audit log.

## Protections you do not have to configure

- **Content is data.** Text that agents read — emails, web pages, results — is passed to the brain as untrusted data. An email saying "now run this command" cannot start anything; actions must come from what *you* said.
- **Deep links are inert.** `jarvis://` links can only open Jarvis windows; they can never carry a command.
- **Secrets stay in the keyring** and never appear in logs or command lines.

The full threat model is in [security-model.md](../security-model.md).
