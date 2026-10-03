# Install Jarvis

All installers are on the [latest release page](https://github.com/lopadova/jarvis-desktop/releases/latest). Replace `<version>` below with the version you downloaded (for example `0.1.0`).

> **About unsigned builds.** Code signing for macOS (Apple Developer ID + notarisation) and Windows (a code-signing certificate) costs money every year. Until the project can afford it, v0.1 installers ship **unsigned**. The app is the same as the one built from source by our public CI; the OS simply cannot verify the publisher, so it warns you. The steps below are the safe, standard way to open it. See the [roadmap](../../ROADMAP.md) for signed installers.

If you want extra assurance, compare the file's SHA-256 with the checksum listed on the release page before installing.

## macOS (12 Monterey or newer)

1. Download the right file:
   - Apple Silicon (M1/M2/M3/M4…): `Jarvis_<version>_aarch64.dmg`
   - Intel: `Jarvis_<version>_x64.dmg`

   Not sure? Apple menu › **About This Mac** → "Chip" says Apple M… or Intel.
2. Open the `.dmg` and drag **Jarvis** into **Applications**.
3. Open Applications, **right-click** (or Control-click) Jarvis › **Open** › **Open**.
   - If macOS only offers "Move to Trash" / "Done": open **System Settings › Privacy & Security**, scroll down and click **Open Anyway** next to the Jarvis message, then confirm.
   - Terminal alternative (only if you are comfortable with it): `xattr -dr com.apple.quarantine /Applications/Jarvis.app`
4. You only need to do this once. Jarvis appears in the menu bar.
5. When asked, allow **Microphone** access. Optional later: **Accessibility** (for dictation into other apps) and **Screen Recording** (for "what's on my screen").

## Windows (10 and 11, x64)

1. Download `Jarvis_<version>_x64-setup.exe` (recommended) or `Jarvis_<version>_x64_en-US.msi` (for managed installs).
2. Run it. If **Microsoft Defender SmartScreen** says "Windows protected your PC", click **More info** › **Run anyway**.
3. Follow the installer. Jarvis starts in the system tray (you may need to click the `^` arrow to see the icon; drag it to the taskbar to keep it visible).
4. Allow microphone access if Windows asks. If Jarvis cannot hear you, check **Settings › Privacy & security › Microphone** and make sure "Let desktop apps access your microphone" is on.

> **WebView2 Runtime.** Jarvis draws its windows with Microsoft's WebView2, which Windows 11 includes. On a clean install or on Windows 10 the setup program installs it for you. The **portable zip** does not: if you see a message about a missing "WebView2 Runtime", install the [Evergreen Bootstrapper](https://developer.microsoft.com/microsoft-edge/webview2/) once and start Jarvis again.
>
> **Portable zip (unsigned).** Keep `agent-host.exe` next to `jarvis-desktop.exe`. If Smart App Control blocks it ("an app control policy blocked this file"), it only trusts signed apps: use a signed release when available, or turn the feature off (a one-way switch on most Windows 11 builds, so check first).

> Windows uses `Alt+Space` for the window menu. In Jarvis Settings › Shortcuts we suggest switching push-to-talk to `Ctrl+Alt+Space`.

## Linux (x86_64)

Pick one format:

**AppImage** (any distribution):

```bash
chmod +x Jarvis_<version>_amd64.AppImage
./Jarvis_<version>_amd64.AppImage
```

**Debian / Ubuntu** (`.deb`):

```bash
sudo apt install ./Jarvis_<version>_amd64.deb
```

**Fedora / openSUSE** (`.rpm`):

```bash
sudo dnf install ./Jarvis-<version>-1.x86_64.rpm
```

Notes:
- The tray icon needs a StatusNotifier/AppIndicator host. GNOME users may need the *AppIndicator and KStatusNotifierItem Support* extension.
- **Wayland:** global shortcuts depend on your compositor and desktop portal. On some setups push-to-talk only works while a Jarvis window is focused; the wake word and the tray still work. X11 sessions are not affected.
- Linux has no system-wide window blur, so Jarvis uses solid (opaque) surfaces.

## First-run downloads

The on-device speech models (wake word, voice-activity detection, Whisper) are downloaded from **Settings › Microphone & wake word › Download models** and stored in the `models/` folder of the data directory. The Whisper size you pick decides the download (see [Microphone](microphone.md#local-transcription-whisper)). The Piper voice binary and voices are downloaded the first time you use them.

## Updating

v0.1.0 has no automatic updates yet (update signing is not configured). To update, download the newer installer from the releases page and install over the existing app; your settings, memory and history are kept.

## Uninstalling

- **macOS:** quit Jarvis from the menu bar, drag it from Applications to the Trash.
- **Windows:** Settings › Apps › Installed apps › Jarvis › Uninstall.
- **Linux:** `sudo apt remove jarvis` / `sudo dnf remove jarvis`, or delete the AppImage.

Your data stays in the data directory until you delete it (paths in [Memory & privacy](memory-privacy.md#where-your-data-lives)). Secrets are in the OS keyring under "Jarvis".

## Build from source

See [Development setup](../contributing/dev-setup.md).
