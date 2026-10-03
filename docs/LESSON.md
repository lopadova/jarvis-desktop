# Lessons learned

A running log of non-obvious findings, newest first. Consolidate into docs and rules at each milestone.

## 2026-10-03
- **sherpa-onnx on Windows + Tauri:** the official `sherpa-onnx` crate downloads prebuilt `/MT` static libs (no bindgen/libclang). Do **not** add `+crt-static`: `tauri-build` already links vcruntime statically with a dynamic UCRT, and adding crt-static drops the UCRT (unresolved `fmod`, `sin`, …).
- **sherpa-onnx streams abort on a sample-rate change** ("You changed the input sampling rate!!" → process exit). Always feed one fixed rate (16 kHz) per stream.
- **KWS keywords must be BPE-tokenised** for the gigaspeech Zipformer KWS model: "JARVIS" → `▁JA R VI S` (computed with sentencepiece from the model's `bpe.model`). Format: `tokens :boost #threshold @LABEL`.
- **Windows Smart App Control** blocks freshly compiled unsigned binaries (cargo build scripts, proc-macro DLLs, the Tauri CLI `.node`) with os error 4551. Workaround used here: build/test in a Linux container and cross-build Windows with `cargo-xwin`. The cross-built exe was allowed to run.
- **cargo-xwin on Linux:** alias `PathCch.lib` → `pathcch.lib` in the xwin SDK dir (case-sensitive FS).
- **UNC paths leak NTLM:** validate `host.open` / terminal paths lexically (only `Disk`/`VerbatimDisk` prefixes, `file://` with no remote host) *before* `canonicalize()` touches the filesystem.
- **Windows Terminal `wt` splits arguments on `;`**: escape it as `\;`. Never pass directories through `cmd /C start` (cmd re-parses the line); set `current_dir` and use `CREATE_NEW_CONSOLE` instead.- **ChatGPT plan tokens:** Sign in with ChatGPT tokens work only with the **Responses API** (`store:false`, `stream:true`). They do **not** cover audio endpoints, so voice must use separate providers.
- **ChatGPT needs a relay:** ChatGPT accepts only **remote HTTPS** MCP servers. "Use Jarvis inside ChatGPT" therefore needs a relay: a Cloudflare Worker + Durable Object, with an outbound WebSocket from the desktop.
- **ElevenLabs models:** `eleven_v3` supports expressive audio tags but **not** the WebSocket `stream-input` endpoint. Use HTTP streaming for v3, and `eleven_flash_v2_5` over WebSocket for low latency.
- **Security from day one:** a voice assistant that can run shell commands needs safe-by-default permissions, inert deep links and "content is data" routing from the start (see `docs/security-model.md`).
