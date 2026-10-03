# @jarvis/desktop

The Tauri 2 app: a thin Rust shell (`src-tauri/`) and a React 19 UI (`src/`). All product logic
lives in the TypeScript sidecar (`packages/agent-host`); see ADR 0001 and ADR 0002.

## Run

```bash
pnpm install
pnpm --filter @jarvis/desktop dev          # UI only, in a browser, with mock data (no Tauri needed)
pnpm --filter @jarvis/desktop tauri dev    # full app (needs Rust + Bun; falls back to `bun run` for the sidecar)
```

Mock mode is on automatically outside Tauri, or with `?mock=1`. Routes: `#/home`, `#/pill`,
`#/sessions`, `#/settings?tab=voice`, `#/onboarding`. In mock mode, typing a message containing
"delete" raises a high-risk approval and "build" raises a medium-risk one.

In the browser preview every window is drawn at its design size on the design wallpaper
(`html[data-desk]`). Preview switches: `?theme=dark|light`, `?material=glass|solid`,
`?locale=en|it`, `?platform=mac|win|linux` (window chrome), `?hue=200` (accent),
`?private=1`, `?pill=idle-hint|listening|thinking|speaking|clarify|approval-low|approval-medium|approval-high|error|muted`,
`?sessions=0`, `?onboarding=1` (first-run providers). Example:
`http://localhost:1420/?mock=1&platform=mac&theme=light&pill=approval-high#/pill`.

The UI follows the Claude Design handoff in `docs/design/handoff/` (`Jarvis Desktop.dc.html`
plus the component prototypes). Tokens live in `src/styles/tokens.css`; Settings and Onboarding are
code-split (`React.lazy`). Screenshots of every surface are in `resources/screenshots/`.

Headless check of the native subsystems (keyring, audio devices, model paths):

```bash
cd src-tauri && cargo run -- --self-test    # or: jarvis-desktop --self-test on an installed build
```

## Layout

| Path | What |
|---|---|
| `src/types/ui.ts` | Brief §7 contract (re-exported from `@jarvis/core`) |
| `src/styles/tokens.css` | Brief §4 tokens; `globals.css` maps them into Tailwind `@theme` |
| `src/ipc/` | JSON-RPC WebSocket client (role `ui`), mock backend, transport selection |
| `src/store/` | zustand store + pure reducer for `ui.*` notifications |
| `src/components/` | Presentational surfaces (pill, sessions, home, onboarding, settings, common, ui) |
| `src/surfaces/` | Containers that wire the store/IPC/Tauri commands to the components |
| `src/i18n/` | `en.json` / `it.json` + a tiny typed `t()` |
| `src-tauri/src/sidecar.rs` | Sidecar supervision: token in env, `JARVIS_READY <port>`, restart with backoff |
| `src-tauri/src/ipc.rs`, `host.rs` | Shell WebSocket client (role `shell`) and `host.*` handlers |
| `src-tauri/src/oscmd.rs` | Terminal / speech / open command construction (argv only, R8) |
| `src-tauri/src/secrets.rs` | OS keyring wrapper (R6) |
| `src-tauri/src/audio.rs` | TTS playback (rodio), level + end reporting |
| `src-tauri/src/voice/` | Capture (cpal → rtrb → rubato), KWS / VAD / Whisper (sherpa-onnx), FSM, clap, models |
| `src-tauri/src/surfaces.rs`, `tray.rs`, `shortcuts.rs`, `deeplink.rs`, `focus.rs` | OS integration |

## Sidecar binary

`tauri.conf.json` bundles `binaries/agent-host` as an `externalBin`
(`binaries/agent-host-<target-triple>[.exe]`, built by `pnpm sidecar:build`). The folder is
gitignored. Debug builds fall back to `bun run packages/agent-host/src/main.ts` when the binary is missing.

## Voice models

On first use, Settings › Microphone downloads the models from the official sherpa-onnx GitHub
releases into `<dataDir>/models`, then checks the size and SHA-256 (pinned in
`src-tauri/src/voice/models.rs`; Whisper medium is checked by size only):
the Zipformer KWS model (wake word "Jarvis"), Silero VAD, and Whisper (default `small`).
Voice input stays disabled until they are present. Push-to-talk with a cloud STT still works,
with an energy-based VAD fallback.

## Windows build notes

sherpa-onnx ships Windows static libraries built with `/MT`. This links fine because
`tauri-build` already links the VC runtime statically (`libcmt` + `libvcruntime`, with a dynamic
UCRT). Do **not** add `-C target-feature=+crt-static`: combined with Tauri's link arguments it
removes the UCRT entirely, and the link fails with unresolved `fmod`, `sin`, `strlen` …
Building needs the MSVC C/C++ build tools (Visual Studio "Desktop development with C++"),
because a few build scripts compile C (bzip2, vswhom).

Cross-checking from Linux works with `cargo xwin build --target x86_64-pc-windows-msvc`. On a
case-sensitive filesystem you need to alias `PathCch.lib` to `pathcch.lib` in the xwin SDK dir.

## Updater

`tauri-plugin-updater` is wired, but `plugins.updater.pubkey` in `tauri.conf.json` is a
placeholder. Before the first signed release:
1. generate a key with `pnpm tauri signer generate`;
2. put the public key in `pubkey`;
3. store the private key in CI secrets;
4. set `bundle.createUpdaterArtifacts` to `true`.
