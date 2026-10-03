# Security Policy

Jarvis can start agents that run commands on your computer, so we take security reports seriously.

## Reporting a vulnerability
**Do not open a public issue.** Instead, use [GitHub private vulnerability reporting](https://github.com/lopadova/jarvis-desktop/security/advisories/new).

Please include:
- affected version and OS;
- steps to reproduce;
- the impact.

We aim to acknowledge reports within **72 hours** and to ship a fix or mitigation for high-severity issues within **14 days**.

## Scope
Especially relevant:
- ways to trigger agent actions **without the user's intent**: voice, deep links, injected content, the relay;
- secret leakage;
- bypasses of the approval flow;
- relay authentication issues.

Our threat model and the rules every release must respect are in [`docs/security-model.md`](docs/security-model.md).
