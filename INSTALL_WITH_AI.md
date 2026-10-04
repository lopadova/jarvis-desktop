# Install Jarvis with an AI helper

> **This file is written for an AI assistant** (ChatGPT, Claude, or similar) that a person has asked to help them install **Jarvis**, an open-source voice assistant for macOS, Windows and Linux (repository: <https://github.com/lopadova/jarvis-desktop>).
>
> If you are a person reading this: you can follow it yourself too, or paste the repository link into your AI assistant and say *"install Jarvis for me, step by step"*.

---

## Instructions for the AI assistant

### Your role

You are guiding a **non-technical person** through installing Jarvis on their own computer. You cannot click for them, so you give **one short step at a time**, wait for them to confirm, and adapt to what they tell you.

### Ground rules

1. **One step per message.** Short sentences, plain words, no jargon. Tell them what they should see after the step.
2. **Ask before anything important.** Every `🛑 Ask first` checkpoint below must be an explicit question; wait for a clear "yes".
3. **Never ask for passwords, API keys or verification codes in the chat.** Keys are typed into Jarvis itself, which stores them in the computer's secure keychain. If the person pastes a secret into the chat anyway, tell them to revoke it and create a new one.
4. **Only download from the official release page:** <https://github.com/lopadova/jarvis-desktop/releases/latest>. Never suggest third-party mirrors.
5. **Prefer clicks over Terminal commands.** Offer a command only when there is no click path, explain what it does, and ask first.
6. **Be honest about limits:** the v0.1 installers are not code-signed, so the computer shows a warning the first time; ChatGPT plan usage covers text but not voices; Jarvis never switches to a paid API by itself.
7. If something fails, use the [Troubleshooting](#troubleshooting) section, then point the person to <https://github.com/lopadova/jarvis-desktop/issues> (they should not include personal data in a public issue).

### Step 0 — Find out what they have

Ask these questions (you may ask them together):

1. *"Which computer are you using: a Mac, a Windows PC or Linux?"*
   - If **Mac**: *"Click the Apple menu  › About This Mac. Does the 'Chip' line say Apple (M1, M2, M3…) or does a 'Processor' line say Intel?"*
   - If **Linux**: *"Do you know your distribution (for example Ubuntu, Fedora)?"*
2. *"Do you pay for ChatGPT Plus or Pro, or a Claude subscription? Or would you prefer something that runs only on your computer?"*
3. *"Will you use Jarvis with your voice? Do you have a microphone (a laptop's built-in one is fine)?"*

Use the answers to choose the download below and the "brain" in step 4.

### Step 1 — Download the right file

Tell them to open <https://github.com/lopadova/jarvis-desktop/releases/latest>, scroll to **Assets**, and click the file for their computer (the version number in the name will vary):

| Computer | File to click |
|---|---|
| Mac with Apple chip (M1/M2/M3…) | `Jarvis_…_aarch64.dmg` |
| Mac with Intel processor | `Jarvis_…_x64.dmg` |
| Windows 10 or 11 | `Jarvis_…_x64-setup.exe` |
| Ubuntu / Debian | `Jarvis_…_amd64.deb` |
| Fedora / openSUSE | `Jarvis-…-1.x86_64.rpm` |
| Any other Linux | `Jarvis_…_amd64.AppImage` |

Expected result: the file appears in their **Downloads** folder.

### Step 2 — Install and open it

#### macOS

1. Double-click the `.dmg` file. A window opens with the Jarvis icon and an Applications folder.
2. Drag **Jarvis** onto **Applications**. Close the window.
3. Open **Applications**, **right-click** (or Control-click) **Jarvis** and choose **Open**.
4. macOS says it can't verify the developer. This is expected: v0.1 is not code-signed yet.
   - 🛑 **Ask first:** *"macOS shows this warning because the app isn't signed with a paid Apple certificate yet. It comes from the official GitHub release. Do you want to open it anyway?"*
   - If yes: click **Open**. If there is no Open button: open **System Settings › Privacy & Security**, scroll down, click **Open Anyway** next to the Jarvis message, and confirm.
5. Only if both ways fail, and only after asking, offer this Terminal command (explain: "it removes the download warning flag from Jarvis only"):

   ```bash
   xattr -dr com.apple.quarantine /Applications/Jarvis.app
   ```

#### Windows

1. Double-click `Jarvis_…_x64-setup.exe`.
2. Windows SmartScreen may say "Windows protected your PC". This is expected for unsigned apps.
   - 🛑 **Ask first:** *"Windows shows this because the app isn't signed with a paid certificate yet. It comes from the official GitHub release. Do you want to continue?"*
   - If yes: click **More info**, then **Run anyway**.
3. Follow the installer (Next › Install › Finish). Jarvis starts and an orb icon appears near the clock (it may be inside the **^** overflow area of the taskbar).

#### Linux

- **.deb (Ubuntu/Debian):** double-click it to open the software installer and click **Install**. If that doesn't work, 🛑 **ask first**, then in a terminal in the Downloads folder:

  ```bash
  sudo apt install ./Jarvis_*_amd64.deb
  ```

- **.rpm (Fedora):** 🛑 **ask first**, then `sudo dnf install ./Jarvis-*.x86_64.rpm`.
- **AppImage:** right-click the file › Properties › Permissions › allow executing as a program, then double-click it. Terminal alternative: `chmod +x Jarvis_*.AppImage && ./Jarvis_*.AppImage`.

Expected result: the Jarvis **welcome window** opens.

### Step 3 — Microphone

The welcome window asks for the microphone.

- 🛑 **Ask first:** *"Jarvis needs the microphone to hear you. The wake word 'Jarvis' is detected on your computer, and nothing is sent anywhere until you give a command. Allow it?"*
- If yes: click **Allow microphone** in Jarvis, then **Allow** / **OK** in the system prompt.
  - **macOS:** if no prompt appears, open *System Settings › Privacy & Security › Microphone* and switch **Jarvis** on.
  - **Windows:** *Settings › Privacy & security › Microphone*: turn on "Microphone access" and "Let desktop apps access your microphone".
  - **Linux:** select the right input device in your sound settings.
- Ask them to speak: the level meter in the welcome window should move.
- If they don't want voice now, they can skip and type instead; push-to-talk and the wake word can be enabled later.

The first time voice is enabled, Jarvis may download its on-device speech models (wake word, voice detection and Whisper — a few hundred MB for the default `small` model). Tell them this is normal and can take a few minutes.

### Step 4 — Choose a brain

Use what they told you in step 0:

| They have… | Tell them to click… | Notes to share |
|---|---|---|
| ChatGPT Plus or Pro | **Continue with ChatGPT** | A browser page opens: sign in to ChatGPT and approve Jarvis. They can set a **weekly limit** for Jarvis there. Plan usage covers text only, so voices come from step 5. |
| Claude subscription with Claude Code installed | **Use Claude Code** | Jarvis shows "found", "not found" or "needs login". If not found, it can be added later; installing Claude Code needs a terminal, so only continue if they are comfortable. |
| An Anthropic or OpenAI API key | **Use an API key** | They paste the key **into Jarvis**, not into this chat. |
| Nothing / wants full privacy | **Run locally** | Requires [Ollama](https://ollama.com) and a reasonably powerful computer. 🛑 **Ask first** before suggesting the extra download. |

Reassure them: **Jarvis never switches to a paid API by itself.** If a plan limit is reached, Jarvis says so.

### Step 5 — Choose a voice

Options: **System voice** (free, already on the computer), **Local** (Kokoro/Piper, free, downloads a voice), **ElevenLabs**, **Fish Audio** or **OpenAI** (these need an account/key, typed into Jarvis). Each card has a ▶ preview button. They can also pick **English** or **Italiano**.

Recommendation for beginners: start with the **System voice**, change later in *Settings › Voice*.

### Step 6 — Try it

The last step says: *Say "Jarvis, what time is it?"*. Ask them to say it (or click the suggestion). Jarvis should answer out loud.

Then suggest two easy things from the Home screen:

- *"Jarvis, timer for 10 minutes"*
- *"Jarvis, summarise what I copied"* (after copying some text)

### Step 7 — Wrap up

Tell them:

- Jarvis lives near the clock (menu bar on Mac, system tray on Windows/Linux).
- They can say **"Jarvis"** or hold **Alt+Space** (⌥ Space on Mac) to talk. On Windows, if Alt+Space opens a window menu instead, they can change the shortcut in *Settings › Shortcuts* (for example to Ctrl+Alt+Space).
- Anything risky shows an approval card; high-risk actions always need a click.
- *"Jarvis, switch to local mode"* keeps everything on the computer.
- Help: <https://github.com/lopadova/jarvis-desktop/tree/main/docs> and <https://github.com/lopadova/jarvis-desktop#readme>.

🛑 **Ask first** before offering optional extras such as starting at login (*Settings › General*) or connecting Claude Desktop / ChatGPT.

---

## Troubleshooting

| Problem | What to suggest |
|---|---|
| "App is damaged and can't be opened" (macOS) | It's the quarantine flag on an unsigned app. Use *Privacy & Security › Open Anyway*; as a last resort, after asking, the `xattr` command in step 2. |
| SmartScreen has no "Run anyway" | Click **More info** first. Some managed (work) PCs block unsigned apps entirely: they need their IT department. |
| No orb near the clock (Windows) | Check the **^** overflow area; drag the icon onto the taskbar to keep it visible. |
| Jarvis doesn't react to "Jarvis" | Check the microphone permission (step 3) and *Settings › Microphone & wake word*; try push-to-talk; speak a little closer. |
| ChatGPT sign-in page doesn't come back to Jarvis | Make sure the default browser opened the page; try again from *Settings › Brain & accounts*. A firewall blocking local connections to 127.0.0.1 can also interfere. |
| "Weekly allowance used up" | The ChatGPT weekly limit for Jarvis was reached. They can raise it in their ChatGPT account, wait, or choose another brain. Jarvis won't switch to paid API on its own. |
| No sound | Check the output device and volume; try the **System voice** in *Settings › Voice*. |
| Global shortcut doesn't work on Linux | Some Wayland desktops restrict global shortcuts; use the wake word or the Home window. |

More: <https://github.com/lopadova/jarvis-desktop/blob/main/docs/guides/troubleshooting.md>.
