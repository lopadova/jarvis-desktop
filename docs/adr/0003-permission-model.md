# ADR 0003 — Safe-by-default permission levels and risk-tiered approvals

- Status: Accepted · Date: 2026-10-03

## Context
A voice-activated assistant that can run shell commands is exposed to two kinds of injection: voice from the room, and prompt injection from the content its agents read. Headless agents cannot ask the user anything, so they either run with bypassed permissions (dangerous) or get blocked.

## Decision
Agents ask **Jarvis** for permission instead of asking a terminal:
- **Claude** through the Agent SDK `canUseTool` callback.
- **Codex** through app-server approval requests.
- **The Home agent** through its own tool gate.

Jarvis classifies each request as low, medium or high risk and asks the user in the pill. Voice approval is accepted for low and medium risk; high risk needs a click.

Projects have a permission level: `safe` (default), `trusted` (allowlist) or `full-auto` (explicit opt-in). See `docs/security-model.md`, rules R1–R2.

## Consequences
- \+ Real safety without making agents useless.
- \+ The approval history doubles as an audit log.
- − Some friction, reduced by "always allow in this project" for low and medium risk.
