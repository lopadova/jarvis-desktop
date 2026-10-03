---
title: "Install"
description: "Install Jarvis on macOS, Windows or Linux, including how to open the unsigned v0.1 builds safely and grant microphone access."
---

# Install

Download the right file from the
[latest release](https://github.com/lopadova/jarvis-desktop/releases/latest):

| System | File | Notes |
|---|---|---|
| macOS, Apple silicon (M1 and later) | `Jarvis_{version}_aarch64.dmg` | Most Macs since 2020 |
| macOS, Intel | `Jarvis_{version}_x64.dmg` | |
| Windows 10/11, 64-bit | `Jarvis_{version}_x64-setup.exe` | Recommended installer |
| Windows (managed IT) | `Jarvis_{version}_x64_en-US.msi` | For deployment tools |
| Linux, any distro | `Jarvis_{version}_amd64.AppImage` | No install needed |
| Debian / Ubuntu | `Jarvis_{version}_amd64.deb` | |
| Fedora / openSUSE | `Jarvis-{version}-1.x86_64.rpm` | |

Each release also publishes `SHA256SUMS.txt`. To verify a download, compare its checksum with the
matching line: `shasum -a 256 FILE` (macOS), `Get-FileHash FILE` (Windows PowerShell),
`sha256sum FILE` (Linux).

::: callout warning "v0.1 installers are unsigned" icon:shield-alert
Code signing needs a paid Apple Developer ID and a Windows certificate. Until the project has them
([roadmap](https://github.com/lopadova/jarvis-desktop/blob/main/ROADMAP.md)), your system will warn you
the first time. The steps below are the standard, safe way to open an app you downloaded on purpose
from its official GitHub release. Only ever download Jarvis from
`github.com/lopadova/jarvis-desktop/releases`.
:::

::: tabs
== tab "macOS"
1. Open the `.dmg` and drag **Jarvis** into **Applications**.
2. In Applications, **right-click Jarvis › Open**, then click **Open** in the dialog.
3. If macOS still blocks it: **System Settings › Privacy & Security**, scroll down, click
   **Open Anyway** next to the Jarvis message.
4. When asked, allow **Microphone** access. Later, "what's on my screen" asks for **Screen Recording**
   and dictation asks for **Accessibility** — only when you first use them.

Advanced alternative (Terminal):
```bash
xattr -dr com.apple.quarantine /Applications/Jarvis.app
```

== tab "Windows"
1. Run `Jarvis_{version}_x64-setup.exe`.
2. If **Microsoft Defender SmartScreen** appears, click **More info › Run anyway**.
   (The portable zip also needs the Microsoft **WebView2 Runtime**, included in Windows 11; on a clean install or Windows 10, install the Evergreen Bootstrapper from Microsoft once. Keep `agent-host.exe` next to `jarvis-desktop.exe`.)
3. Follow the installer. Jarvis starts in the system tray (click the `^` arrow near the clock if you
   don't see it).
4. If no sound is captured: **Settings › Privacy & security › Microphone** and enable
   *Let desktop apps access your microphone*.

Tip: `Alt+Space` opens the window menu in many Windows apps — pick `Ctrl+Alt+Space` as push-to-talk in
**Settings › Shortcuts**.

== tab "Linux"
AppImage:
```bash
chmod +x Jarvis_*_amd64.AppImage
./Jarvis_*_amd64.AppImage
```
Debian/Ubuntu:
```bash
sudo apt install ./Jarvis_*_amd64.deb
```
Fedora:
```bash
sudo dnf install ./Jarvis-*-1.x86_64.rpm
```
Notes:
- The tray icon needs an AppIndicator-capable desktop (GNOME users: the *AppIndicator* extension).
- On **Wayland**, global shortcuts may be limited by the compositor; the wake word and the tray still
  work. An X11 session gives full push-to-talk support.
- Transparency effects fall back to solid surfaces.
:::

## After installing

- The first launch opens the [welcome wizard](/get-started/first-run).
- Local speech models (wake word, voice detection, Whisper) are downloaded from **Settings › Microphone &
  wake word › Download models** into the `models` folder of your data directory — see [Microphone](/guides/microphone).
- Updates: v0.1.0 has no automatic updates yet. Download the newer installer from the releases page and
  install over the existing app; settings, memory and history are kept.

## Uninstall

- **macOS:** quit Jarvis, drag it from Applications to the Bin.
- **Windows:** *Settings › Apps › Installed apps › Jarvis › Uninstall*.
- **Linux:** delete the AppImage, or `sudo apt remove jarvis` / `sudo dnf remove jarvis`.

Your data (history, memory, downloaded models) stays in the data directory until you delete it:

| OS | Data directory |
|---|---|
| macOS | `~/Library/Application Support/Jarvis` |
| Windows | `%APPDATA%\Jarvis` |
| Linux | `~/.local/share/jarvis` (or `$XDG_DATA_HOME/jarvis`) |

Secrets live in your OS keyring (Keychain, Windows Credential Manager, Secret Service) under *Jarvis*.
