# Lessons: docs, docs-site and workflows

To be consolidated into `docs/LESSON.md` by the integrator. Newest first.

## 2026-10-03

- **tauri-action v1 is stricter about drafts.** It fails if `draft: true` is set but the release isn't a draft, and it now updates the name and body of existing releases. The least-privilege pattern is to let build jobs only build: they run with a read-only token and leave out `releaseId`/`tagName`. A single `publish` job then gets `contents: write`, creates the draft with `gh release create --draft`, and uploads every artifact plus `SHA256SUMS.txt`.
- **Pin actions by SHA, and dereference annotated tags.** `gh api repos/O/R/git/ref/tags/T` returns `object.type == "tag"` for annotated tags. Follow it with `gh api repos/O/R/git/tags/<sha>` to get the commit SHA. `dtolnay/rust-toolchain` pinned by SHA needs an explicit `toolchain: stable` input.
- **Never `${{ }}`-interpolate user-controllable values into `run:` scripts.** That includes a `workflow_dispatch` tag input. Pass them through `env:` and use shell variables. Even a comment containing `${{ }}` inside `run:` is evaluated by Actions.
- **tauri-build checks paths at compile time.** It checks that `frontendDist` and every `externalBin` exist, even for `cargo clippy` and `cargo test`. CI must build the UI and a host-triple sidecar before running any cargo command.
- **The docmd raw-HTML guard is line-based and ignores only fenced blocks.** A placeholder like `<version>` fails it even inside inline backticks. In docs-site pages, write placeholders as `{version}` or `YOUR-WORKER`. Plain GitHub markdown (README, `docs/`) can keep `<version>`.
- **GitHub heading anchors keep underscores and turn " — " into `--`.** For example, `## ChatGPT plan — Sign in with ChatGPT` becomes `#chatgpt-plan--sign-in-with-chatgpt`. Link checkers must slug the same way.
- **Worktree-isolated agents get complex Bash refused.** That covers heredocs, loops, pipes combined with `cd`, and computed `gh` arguments. Create files with the Write tool and run simple single commands. Put helper scripts in the scratchpad and run them with `node`.
- **docmd 0.9.x works with the 0.8 config shape** used by the reference site: same `layout`, `navigation` and `plugins.search` semantic keys. Pair it with `docmd-search` 0.1.6, `@huggingface/transformers` 4.3 and `onnxruntime-node` 1.30. Keep `package-lock.json` committed: Cloudflare Pages runs `npm ci`.
- **docmd 0.9.7 applies every ancestor `.gitignore` to absolute paths.** Building inside `.claude/worktrees/...` finds **0 pages**, because the root `.gitignore` has `.claude/`. The build still exits 0. Verify by building from a copy outside `.claude/` (junction `node_modules`) and check the "Generated N pages" line. CI and normal clones are not affected.
- **docmd-search writes its index into `docs/_docmd-search/`**, inside the source folder. That folder is easy to commit by accident. `docs-site/.gitignore` now ignores it.
- **docmd 0.9.7 warns that the top-level `description` in `docmd.config.json` is ignored.** Keep the description in `plugins.seo`.
- In docmd container titles use curly quotes “ ” rather than escaped `\"`. Fenced code inside `::: steps` items and `::: tabs` panes renders fine.
- **Found while documenting:** in `packages/core/src/router/fastpath.ts`, "alarm at 7.45 pm" parses as 07:00. The normaliser replaces `.` with a space before `parseClock` runs. "7:45 pm" works. Needs a fix and a test, owned by core.
