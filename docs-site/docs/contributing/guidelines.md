---
title: "How to contribute"
description: "Ways to help Jarvis — code, docs, translations, testing on your OS — and the rules for issues, pull requests and security reports."
---

# How to contribute

Jarvis is MIT-licensed and built in the open. Every kind of help counts.

::: grids
  ::: grid
    ::: card "Try it and report" icon:bug
    Test on your OS, microphone and language. A clear bug report with steps is gold. **[Open an issue →](https://github.com/lopadova/jarvis-desktop/issues/new/choose)**
    :::
  :::
  ::: grid
    ::: card "Suggest a feature" icon:lightbulb
    Especially everyday ones: what would you like to say to your computer? **[Request →](https://github.com/lopadova/jarvis-desktop/issues/new/choose)**
    :::
  :::
  ::: grid
    ::: card "Improve the docs" icon:book-open
    Typos, clearer steps, screenshots, troubleshooting tips. Every page has an edit link.
    :::
  :::
  ::: grid
    ::: card "Translate" icon:languages
    English and Italian ship first. Help with phrasing, or prepare the next language.
    :::
  :::
:::

## Pull requests

::: steps
1. **Discuss first** for anything larger than a small fix — open an issue so we agree on the approach.
2. **Branch** from `main` and keep the change focused.
3. **Test** — `pnpm lint`, `pnpm typecheck`, `pnpm test`, and Rust checks if you touched the shell.
   New behaviour needs tests; security-relevant behaviour needs security tests.
4. **Document** — update the guide, reference or ADR your change affects, and add a line to
   `CHANGELOG.md` under *Unreleased*.
5. **Open the PR** using the template and describe how you tested it on which OS.
:::

## House rules

- **Security rules are not negotiable.** Read the [security model](/security/model). No string-built
  shell commands, no secrets outside the keyring, no actions derived from untrusted content, no silent
  paid fallback.
- **Everything optional degrades gracefully.** Every provider is optional; the app always starts and
  explains what is missing.
- **Every user-visible string in English and Italian.**
- **Accessibility:** keyboard navigation, visible focus, WCAG AA contrast, reduced-motion support.
- **Small dependencies.** Justify any new heavy dependency.

## Security issues

Never open a public issue for a vulnerability. Use
[private vulnerability reporting](https://github.com/lopadova/jarvis-desktop/security/advisories/new).

## Code of conduct

We follow the Contributor Covenant 2.1. Be kind, assume good intent, and help newcomers.

Set up your machine: [Development setup](/contributing/dev-setup).
