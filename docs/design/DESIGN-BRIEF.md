# Jarvis Desktop — Design Brief

> **Audience:** a design-generation agent (e.g. Claude Design) or a human product designer.
> **Goal:** produce a complete, pixel-precise UI template for **Jarvis Desktop**, a cross-platform (macOS · Windows · Linux) voice assistant built with **Tauri 2 + React 19**. The template you deliver will be wired to the real app *as-is*, so follow the technical contract in §3 and §7 exactly.

---

## Table of contents

1. [The product in one minute](#1-the-product-in-one-minute)
2. [Brand & visual identity](#2-brand--visual-identity)
3. [Technical contract (non-negotiable)](#3-technical-contract-non-negotiable)
4. [Design tokens](#4-design-tokens)
5. [Surfaces & windows](#5-surfaces--windows)
6. [Components inventory](#6-components-inventory)
7. [Data contracts (props)](#7-data-contracts-props)
8. [Motion](#8-motion)
9. [Copy & i18n](#9-copy--i18n)
10. [Accessibility](#10-accessibility)
11. [Deliverables & folder structure](#11-deliverables--folder-structure)
12. [Acceptance checklist](#12-acceptance-checklist)

---

## 1. The product in one minute

Jarvis lives in the menu bar / system tray. You say **"Jarvis"** (or hold a shortcut, or double-clap) and speak naturally. Jarvis:

- answers quick things immediately, out loud (time, timers, reminders, "what did that email say?");
- hands real work to **background agents** — Claude Code, Codex, or its built-in "Home" agent — and narrates progress ("I'm editing the hero section now…");
- **asks before doing anything risky** (an approval card: *"Run `rm -rf dist`? Allow · Deny"*);
- works with the subscriptions people already pay for: **ChatGPT (Sign in with ChatGPT)**, **Claude Code**, **Codex**, or API keys, or fully **local** models.

Two kinds of users, one UI:

| Everyday user | Developer |
|---|---|
| Morning briefing, reminders, "summarise what I copied", dictation, "what's on my screen?" | "In project *shop* add a footer", "how's it going?", "continue with Codex", approvals |

**Design principle:** *calm by default, alive when spoken to.* Jarvis is mostly invisible; when it wakes, it should feel present, responsive and trustworthy — never noisy.

---

## 2. Brand & visual identity

### Personality
Warm · capable · discreet · a little playful. Think *"a brilliant colleague sitting next to you"*, not *"a robot butler"* and not *"sci-fi cockpit"*.

**Keywords:** luminous, soft depth, precise, human, quiet confidence.
**Avoid:** HUD/targeting-reticle clichés, neon overload, glitch effects, anything resembling existing film franchises' AI interfaces (trademark risk), skeuomorphic microphones.

### Signature element — the Orb
A small luminous sphere is the heart of the brand. It appears in the logo, the listening pill, the tray icon (monochrome template version) and onboarding.

- **Idle:** slow breathing glow (≈4 s cycle), low intensity.
- **Listening:** the orb's surface reacts to mic level (0–1); a soft waveform ring around it.
- **Thinking:** gentle rotating gradient sweep inside the orb.
- **Speaking:** pulses in sync with the TTS amplitude (0–1).
- **Needs approval:** steady amber halo.
- **Error:** brief desaturated shake, then calm red ring.
- **Local/private mode:** a thin green ring (it means "nothing leaves this computer").

The orb must be implementable in **CSS/SVG** (no WebGL requirement; an optional `<canvas>` enhancement is fine if it degrades to CSS).

### Logo
Wordmark **"Jarvis"** + orb glyph. Provide: full colour, monochrome dark, monochrome light, and a 16/32/44/64/128/256/512/1024 px app icon set (rounded-square for macOS, square for Windows/Linux). Tray icon: monochrome *template* SVG, 18×18 px (macOS) and 16×16/32×32 (Windows), with a "busy" variant (small dot).

### Suggested direction (you may refine, keep the spirit)
- **Dark-first** ("Midnight Glass") with a fully designed light theme ("Paper Glass").
- Primary accent **Arc** (cool cyan-blue) for listening/active; secondary **Ember** (warm amber) for speaking/attention; semantic green/red/amber.
- The accent is **user-customisable** (a single hue variable drives it).

---

## 3. Technical contract (non-negotiable)

| Topic | Requirement |
|---|---|
| Framework | **React 19 + TypeScript (strict)**, function components only, no class components |
| Styling | **Tailwind CSS v4** (CSS-first config, `@theme`), tokens as CSS variables (§4) |
| Components | **shadcn/ui** (Radix primitives) — generated into `src/components/ui/` |
| Motion | **Motion** (`motion/react`) for orchestrated animation; CSS for simple transitions |
| Icons | **lucide-react** only (plus the custom SVGs you deliver: logo, orb, agent marks) |
| Fonts | **Self-hosted**, no network fonts: `@fontsource-variable/inter` (UI) and `@fontsource-variable/jetbrains-mono` (commands, paths). Both OFL. |
| No business logic | Components are **presentational**: data in via props, events out via callbacks. No `fetch`, no Tauri APIs, no global stores. |
| Windows | Frameless + transparent (Tauri `decorations:false`, `transparent:true`). Draggable areas use `data-tauri-drag-region`. Provide your own window controls where needed (§5). |
| Materials | Every surface ships in **two variants**: `glass` (translucent; the OS provides blur: macOS vibrancy, Windows 11 Mica/Acrylic) and `solid` (opaque fallback for Linux, Windows 10, and "reduce transparency"). Switch via `data-material="glass|solid"` on `<html>`. Never rely on `backdrop-filter` alone for legibility. |
| Themes | `data-theme="dark|light"` on `<html>`, plus `prefers-color-scheme` default. |
| Performance | 60 fps; animate only `transform` and `opacity` (and CSS variables feeding them). No layout thrash. Pill/orb idle animation must cost ~0 % CPU when the window is hidden (pause on `visibilitychange`). |
| DPI | Crisp at 1×, 1.25×, 1.5×, 2×; use SVG for all iconography. |
| Platform nuances | Respect OS conventions where it matters: window controls on the left on macOS, right on Windows/Linux (prop `platform: 'mac'|'win'|'linux'`). Keyboard hints show `⌘` on macOS and `Ctrl` elsewhere. |
| Bundle | No heavy dependencies beyond the list above without justification. |

---

## 4. Design tokens

Deliver `src/styles/tokens.css` defining (at least) the following CSS custom properties for **dark** and **light**, and for **glass** and **solid** materials. Names are a contract; values are yours.

```css
/* colour — surfaces */
--color-bg; --color-surface; --color-surface-raised; --color-surface-sunken;
--color-overlay;              /* scrim behind modals */
--color-border; --color-border-strong;
/* colour — text */
--color-text; --color-text-muted; --color-text-subtle; --color-text-inverse;
/* colour — accent & semantic */
--accent-hue;                 /* number, user-customisable, e.g. 200 */
--color-accent; --color-accent-contrast; --color-accent-soft;
--color-ember; --color-success; --color-warning; --color-danger; --color-info;
--color-private;              /* local/private-mode green */
/* orb */
--orb-core; --orb-glow; --orb-ring;
/* radius */
--radius-xs; --radius-sm; --radius-md; --radius-lg; --radius-xl; --radius-pill;
/* elevation */
--shadow-sm; --shadow-md; --shadow-lg; --shadow-glow;
/* glass */
--glass-tint; --glass-opacity; --blur-sm; --blur-md;   /* blur only as enhancement */
/* spacing scale (4px base) */
--space-1 … --space-12;
/* type */
--font-sans; --font-mono;
--text-xs; --text-sm; --text-base; --text-lg; --text-xl; --text-2xl; --text-display;
--leading-tight; --leading-normal;
/* motion */
--duration-instant; --duration-fast; --duration-normal; --duration-slow;
--ease-standard; --ease-emphasized; --ease-spring-like;
```

Also map them into Tailwind v4 via `@theme` so utilities like `bg-surface`, `text-muted`, `rounded-lg`, `shadow-glow` work.

**Contrast:** text tokens must meet **WCAG AA** on every surface in every theme × material combination (document the ratios).

---

## 5. Surfaces & windows

Each surface is a separate Tauri window. Sizes are logical pixels.

| # | Surface | Window | Size | Notes |
|---|---|---|---|---|
| S1 | **Listening Pill** | always-on-top, no focus steal, top-centre of active screen, 12 px below menu bar | collapsed **360×64**, expanded up to **560×(auto ≤ 420)** | The orb + live transcript + state. Expands for clarify, approval, error. |
| S2 | **Sessions Panel** | always-on-top, draggable, default top-right (24 px margins) | **380×auto** (max 70 % screen height, scroll inside) | Live list of background agent sessions. |
| S3 | **Home (main window)** | normal window, resizable | default **960×680**, min **720×520** | Chat-style home with suggestion chips, conversation, composer. |
| S4 | **Onboarding** | modal-like window, centred | **720×560** fixed | 5 steps. |
| S5 | **Settings** | normal window | **820×600**, min **720×520** | Sidebar tabs. |
| S6 | **Tray menu** | native menu | — | Provide the item list + icons; it renders natively (we only need SVG icons + copy). |
| S7 | **Toasts / notifications** | in-app toast (inside S3/S5) + native OS notifications (copy only) | toast **360×auto** | |

### S1 — Listening Pill (most important surface)
Layout (collapsed): `[orb 40px] [transcript, 1–2 lines, fades at edges] [state chip] [shortcut hint]`.

States (each needs a preview):
1. `idle-hint` — shown only briefly after setup: "Say *Jarvis* or hold ⌥Space".
2. `listening` — orb reacts to `level`; transcript streams in word by word (partial words in `--color-text-subtle`, committed in `--color-text`).
3. `thinking` — transcript frozen, subtle shimmer; optional "Using ChatGPT" provider badge.
4. `speaking` — Jarvis's reply text, karaoke-style highlight synced to `progress` (0–1); a small "■ stop" affordance.
5. `clarify` — Jarvis asked a question; question text + 2–4 **quick-reply chips** + "or just say it".
6. `approval` — expanded **Approval Card** (see §6) — the pill grows smoothly.
7. `error` — short message + one action ("Open settings", "Retry").
8. `private` — any state above with the green private ring and a "Local only" chip.
9. `muted` / `focus` — compact grey state ("Muted during Focus").

### S2 — Sessions Panel
- Header: title "Sessions", count badge, **Clear finished**, collapse, close.
- **Session Card** per session (see §6). Running first, then most recent.
- Empty state: friendly illustration (orb resting) + "Nothing running. Try: *'Jarvis, summarise my unread emails'*".
- Compact mode (only running sessions, 1 line each) toggle.

### S3 — Home (chat-style, the "front door")
Layout: left **rail** (64 px, icons: Home, History, Memory, Projects, Settings) · main column (max-width 760 px, centred) · optional right **sessions drawer** (reuses S2 cards).

Main column, top → bottom:
1. **Greeting** — time-aware ("Good morning, Lorenzo") + orb (large, 96 px) + one-line status ("ChatGPT Plus connected · 3 sessions today · Local voice").
2. **Suggestion chips** — the key adoption feature. Grid of chips grouped by **category tabs** (Day, Reminders, Writing, Screen, Files, Web, Home & family, Developer, Memory, Privacy). Each chip: icon + short action text + *small* secondary line with the **spoken equivalent** (e.g. *Say: "Jarvis, good morning"*). Clicking a chip = speaking it. Chips rotate by time of day and context (see §9 catalogue). Must support 6–12 visible chips without crowding; horizontal scroll on narrow widths.
3. **Conversation** — bubbles: user (right), Jarvis (left, with orb avatar), **system cards** inline (session started, approval needed, result ready with "Open" button, reminder set with time). Jarvis bubbles may contain a **"Spoken"** indicator and a replay button.
4. **Composer** — pill-shaped: text input, **mic button** (hold to talk / click to toggle), attach clipboard/screenshot buttons, provider switcher (brain: ChatGPT / Claude / Codex / Local), send. Shows shortcut hint.
5. **Footer status** — usage meter (e.g. "ChatGPT plan: 12 % of weekly cap used"), privacy indicator (mic on/off), connection state.

### S4 — Onboarding (5 steps, progress dots, Back/Next)
1. **Welcome** — big orb, one sentence, "Get started".
2. **Microphone** — why we need it, the privacy promise ("wake word runs on your computer"), "Allow microphone" + live level meter to prove it works.
3. **Choose your brain** — four large option cards:
   - **Continue with ChatGPT** — must follow OpenAI's "Sign in with ChatGPT" button guidelines (we will drop in the official asset; design a slot of **280×44** with neutral surroundings). Subtitle: "Uses your Plus/Pro plan — no API key".
   - **Use Claude Code** — "Uses your Claude subscription via Claude Code" + detection state (found / not found / needs login).
   - **Use an API key** — Anthropic / OpenAI.
   - **Run locally** — Ollama, "Private, needs a capable computer".
   Multiple can be connected; one is marked *primary*.
4. **Voice** — voice provider cards (ElevenLabs, Fish Audio, OpenAI, Local, System) each with ▶ preview, plus language (English / Italiano).
5. **Try it** — "Say *Jarvis, what time is it?*" with the pill rendered inline, success confetti-lite (subtle, respects reduced motion), "Finish".

### S5 — Settings (sidebar tabs)
General · Brain & accounts · Agents & projects · Voice · Microphone & wake word · Privacy · Integrations · Shortcuts · About.
Key patterns to design:
- **Account row** (provider logo, account email, plan, usage bar, Disconnect).
- **Project row** with **permission level** segmented control: `Safe` (default, shield icon) · `Trusted` (shield-check) · `Full auto` (shield-alert, red, requires a confirm dialog explaining risk).
- **Shortcut recorder** (press keys → shows keycaps; conflict warning).
- **Integrations** tab: cards for *Claude Desktop / Cowork* (Install extension), *Codex / Claude Code* (copy command), *ChatGPT* (Relay status + **pairing QR code** + pairing code), *MCP servers* list.
- **Privacy** tab: "Everything local" master switch, retention controls, "Delete history", mic indicator preference.
- **Danger zone** pattern (red outline section).

---

## 6. Components inventory

Build each as a standalone component with a preview showing **all states/variants**. ✱ = new composite, others mostly wrap shadcn.

| Component | Variants / states |
|---|---|
| ✱ `Orb` | sizes 16/24/40/64/96/160; states idle, listening(level), thinking, speaking(level), approval, error, private, muted; `animated` on/off |
| ✱ `ListeningPill` | all S1 states; collapsed/expanded; with/without provider badge |
| ✱ `LiveTranscript` | partial vs committed words; overflow fade; RTL-safe |
| ✱ `ApprovalCard` | risk `low` / `medium` / `high`; kind `shell` / `file-write` / `file-delete` / `network` / `mcp-tool`; shows command in mono with syntax tint, cwd, agent, project; buttons **Allow once** · **Deny** · **Always allow in this project** (hidden for high risk); countdown ring optional; voice hint ("Say *yes* to allow" — hidden for high risk: "Click to confirm") |
| ✱ `SessionCard` | status running / needs-input / approval / done / failed / cancelled; agent claude / codex / home; live activity line; elapsed timer; result preview (2 lines); actions Open result · Log · Reply · Stop |
| ✱ `AgentMark` | claude, codex, home, chatgpt, local — original simple glyphs (do **not** copy third-party logos; for official logos leave a slot) |
| ✱ `SuggestionChip` | default / hover / pressed / disabled; with spoken-equivalent line; compact |
| ✱ `SuggestionGrid` | category tabs + chips; responsive |
| ✱ `ChatBubble` | user / jarvis / system; with spoken indicator, replay, timestamp, error |
| ✱ `SystemCard` | session-started, approval-needed, result-ready, reminder-set, timer-running(countdown), briefing (sections: weather, calendar, email) |
| ✱ `Composer` | idle / typing / recording (waveform) / disabled; provider switcher |
| ✱ `ProviderBadge` | chatgpt, claude, codex, api, local; connected / needs-login / error |
| ✱ `UsageMeter` | percentage + label; warning at 80 %, danger at 100 % ("Weekly cap reached — Jarvis will not switch to paid API automatically") |
| ✱ `PermissionLevelControl` | Safe / Trusted / Full auto (+ confirm dialog) |
| ✱ `ShortcutRecorder` | idle / recording / conflict / saved; keycaps mac vs win |
| ✱ `PairingQR` | QR + code + expiry countdown + status (waiting / paired / expired) |
| ✱ `WindowControls` | mac (left, traffic lights) / win / linux (right) — minimal custom drawn |
| ✱ `EmptyState` | sessions, history, memory, projects |
| ✱ `MemoryItem` | text, created date, source (said / inferred), delete with undo |
| ✱ `KeyHint` | keycap rendering (`⌘` / `Ctrl`, `⌥` / `Alt`) |
| `Toast` | info / success / warning / error / with action |
| `Dialog`, `Tabs`, `Switch`, `Slider`, `Select`, `Tooltip`, `ScrollArea`, `Button` (primary/secondary/ghost/danger/link; sm/md/lg), `Input`, `Badge`, `Progress` | shadcn-based, themed with tokens |

---

## 7. Data contracts (props)

Use **exactly** these types (put them in `src/types/ui.ts`). You may add optional props; do not rename or remove.

```ts
export type Platform = 'mac' | 'win' | 'linux';
export type Theme = 'dark' | 'light';
export type Material = 'glass' | 'solid';
export type Locale = 'en' | 'it';

export type BrainId = 'chatgpt' | 'claude' | 'codex' | 'api-anthropic' | 'api-openai' | 'local';
export type AgentId = 'claude' | 'codex' | 'home';

export type PillState =
  | { kind: 'idle-hint'; shortcut: string[] }
  | { kind: 'listening'; level: number; partial: string; committed: string }
  | { kind: 'thinking'; transcript: string; brain?: BrainId }
  | { kind: 'speaking'; text: string; progress: number; level: number }
  | { kind: 'clarify'; question: string; quickReplies: string[] }
  | { kind: 'approval'; request: ApprovalRequest }
  | { kind: 'error'; message: string; actionLabel?: string }
  | { kind: 'muted'; reason: 'focus' | 'user' };

export interface ListeningPillProps {
  state: PillState;
  privateMode: boolean;
  platform: Platform;
  onStop?(): void;
  onQuickReply?(text: string): void;
  onErrorAction?(): void;
  onApprovalDecision?(id: string, decision: ApprovalDecision): void;
}

export type RiskLevel = 'low' | 'medium' | 'high';
export type ApprovalKind = 'shell' | 'file-write' | 'file-delete' | 'network' | 'mcp-tool';
export type ApprovalDecision = 'allow-once' | 'deny' | 'always-allow-project';

export interface ApprovalRequest {
  id: string;
  kind: ApprovalKind;
  risk: RiskLevel;
  title: string;            // "Run a shell command"
  detail: string;           // the command / path / URL / tool name
  cwd?: string;
  agent: AgentId;
  project?: string;
  reason?: string;          // agent's own explanation, if any
  expiresAt?: number;       // epoch ms, optional countdown
}

export type SessionStatus = 'running' | 'needs-input' | 'approval' | 'done' | 'failed' | 'cancelled';

export interface SessionView {
  id: string;
  agent: AgentId;
  project: string;          // "General" for non-project work
  task: string;
  status: SessionStatus;
  activity?: string;        // "Editing Hero.tsx"
  startedAt: number;
  finishedAt?: number;
  resultPreview?: string;
  resultUrl?: string;       // something to open
}

export interface SessionCardProps {
  session: SessionView;
  locale: Locale;
  onOpen?(id: string): void;
  onLog?(id: string): void;
  onReply?(id: string, text: string): void;
  onStop?(id: string): void;
  onDismiss?(id: string): void;
}

export type SuggestionCategory =
  | 'day' | 'reminders' | 'writing' | 'screen' | 'files' | 'web' | 'home' | 'developer' | 'memory' | 'privacy';

export interface Suggestion {
  id: string;
  category: SuggestionCategory;
  icon: string;             // lucide icon name, e.g. "sunrise"
  label: string;            // "Morning briefing"
  utterance: string;        // "Jarvis, good morning"
  requires?: ('mcp-calendar' | 'mcp-email' | 'screen' | 'clipboard' | 'developer')[];
}

export interface SuggestionGridProps {
  suggestions: Suggestion[];
  activeCategory: SuggestionCategory | 'for-you';
  onCategoryChange(c: SuggestionCategory | 'for-you'): void;
  onPick(s: Suggestion): void;
}

export type ChatMessage =
  | { id: string; role: 'user'; text: string; at: number; viaVoice: boolean }
  | { id: string; role: 'jarvis'; text: string; at: number; spoken: boolean }
  | { id: string; role: 'system'; card: SystemCardData; at: number };

export type SystemCardData =
  | { type: 'session-started'; session: SessionView }
  | { type: 'approval-needed'; request: ApprovalRequest }
  | { type: 'result-ready'; session: SessionView }
  | { type: 'reminder-set'; text: string; dueAt: number }
  | { type: 'timer'; label: string; endsAt: number }
  | { type: 'briefing'; weather?: string; events: { time: string; title: string }[]; emails: { from: string; subject: string }[] };

export interface ProviderStatus {
  id: BrainId;
  connected: boolean;
  account?: string;         // "lorenzo@…"
  plan?: string;            // "ChatGPT Plus"
  usagePct?: number;        // 0..100, undefined = unknown
  state: 'ok' | 'needs-login' | 'cap-reached' | 'error' | 'not-installed';
  primary: boolean;
}

export type PermissionLevel = 'safe' | 'trusted' | 'full-auto';
```

Provide **mock data** for every type in `src/mocks/` (English and Italian copies) and use it in the previews.

---

## 8. Motion

| Moment | Spec |
|---|---|
| Pill appear | fade + scale 0.96 → 1, `--duration-normal` (~240 ms), spring-like ease |
| Pill expand (approval/clarify) | height/width morph via transform-friendly technique (e.g. Motion `layout`), ≤ 280 ms |
| Pill hide | fade + scale 1 → 0.98, ~180 ms |
| Orb idle | breathing glow 4 s ease-in-out infinite; **paused** when hidden |
| Orb listening | glow intensity & ring radius follow `level` (smoothed ~60 ms) |
| Transcript words | each committed word fades from `subtle` to `text` (~120 ms) |
| Chips | hover lift 1 px + shadow; press scale 0.98 |
| Session card status change | colour cross-fade 200 ms; "done" gets a one-shot check animation |
| Reduced motion | `prefers-reduced-motion: reduce` → no scale, no breathing, no confetti; opacity-only, ≤ 100 ms |

---

## 9. Copy & i18n

- Ship **English and Italian** for every string (Italian is ~30 % longer: test layouts with it).
- Tone: short, warm, second person, no jargon for everyday features; precise for developer features.
- Strings live in `src/i18n/en.json` and `src/i18n/it.json` (flat keys like `pill.listening.hint`).

### Suggestion chip catalogue (initial, provide EN + IT)

| Category | Label (EN) | Spoken equivalent (EN) |
|---|---|---|
| day | Morning briefing | "Jarvis, good morning" |
| day | What's on today? | "Jarvis, what do I have today?" |
| day | Prep my next meeting | "Jarvis, prepare me for my next meeting" |
| reminders | Set a timer | "Jarvis, timer for 10 minutes" |
| reminders | Remind me later | "Jarvis, remind me in 20 minutes to call Marco" |
| reminders | Wake me up | "Jarvis, alarm at 7:30" |
| writing | Summarise what I copied | "Jarvis, summarise what I copied" |
| writing | Translate clipboard | "Jarvis, translate what I copied into English" |
| writing | Fix my writing | "Jarvis, fix the grammar of what I copied" |
| writing | Dictate here | "Jarvis, dictate" |
| writing | Reply politely | "Jarvis, write a polite reply to this email" |
| screen | What am I looking at? | "Jarvis, what's on my screen?" |
| screen | Explain this error | "Jarvis, explain this error" |
| files | Find a document | "Jarvis, find the September electricity bill PDF" |
| files | Tidy my Downloads | "Jarvis, tidy up my Downloads folder" |
| web | Research something | "Jarvis, look up reviews of the Pixel 11" |
| web | Compare two products | "Jarvis, compare these two laptops" |
| home | Shopping list | "Jarvis, add milk to the shopping list" |
| home | Tomorrow's weather | "Jarvis, what's the weather tomorrow?" |
| home | Cook with what I have | "Jarvis, a recipe with eggs, spinach and feta" |
| developer | Build something | "Jarvis, in project *shop* add a footer" |
| developer | How's it going? | "Jarvis, how's it going?" |
| developer | Open the result | "Jarvis, open the result" |
| developer | Switch to Codex | "Jarvis, do the same with Codex" |
| memory | Teach me something about you | "Jarvis, remember that I prefer short answers" |
| memory | What do you know about me? | "Jarvis, what do you know about me?" |
| privacy | Go fully local | "Jarvis, switch to local mode" |
| privacy | Forget today | "Jarvis, delete today's history" |

---

## 10. Accessibility

- WCAG 2.2 **AA** contrast for all text and essential icons, in all theme × material combos.
- Full keyboard navigation; visible focus ring (`--color-accent`, 2 px, offset 2 px); logical tab order; `Esc` closes pill/dialogs.
- Live transcript and Jarvis replies announced via `aria-live="polite"`; approval card via `role="alertdialog"` with focus moved to it and **Deny** as the default focused button for high risk.
- Never encode state by colour alone (icons + text labels on status).
- Touch targets ≥ 32 px (desktop) for chips/buttons; 44 px for primary actions.
- Respect `prefers-reduced-motion` and `prefers-reduced-transparency` (→ force `solid`).

---

## 11. Deliverables & folder structure

Deliver a **standalone Vite + React 19 + TS project** that runs with `pnpm i && pnpm dev` and shows a **gallery** of every surface and component state (no Storybook needed — a simple routed gallery is perfect).

```
jarvis-design-template/
  package.json            # react 19, typescript, vite, tailwindcss v4, motion, lucide-react, radix/shadcn deps, fontsource
  index.html
  src/
    main.tsx
    gallery/              # one route per surface + "All components" page; toggles: theme, material, platform, locale, reduced motion
    styles/
      tokens.css          # §4
      globals.css         # Tailwind v4 @import + @theme mapping
    types/ui.ts           # §7 (exact)
    i18n/en.json
    i18n/it.json
    mocks/                # typed mock data for every surface
    components/
      ui/                 # shadcn generated, themed
      orb/Orb.tsx
      pill/ListeningPill.tsx  pill/LiveTranscript.tsx  pill/ApprovalCard.tsx
      sessions/SessionsPanel.tsx  sessions/SessionCard.tsx
      home/HomeScreen.tsx  home/SuggestionGrid.tsx  home/SuggestionChip.tsx  home/ChatBubble.tsx  home/SystemCard.tsx  home/Composer.tsx
      onboarding/Onboarding.tsx (+ one file per step)
      settings/Settings.tsx (+ one file per tab) settings/PermissionLevelControl.tsx settings/ShortcutRecorder.tsx settings/PairingQR.tsx
      common/AgentMark.tsx common/ProviderBadge.tsx common/UsageMeter.tsx common/KeyHint.tsx common/WindowControls.tsx common/EmptyState.tsx
    assets/
      logo/ (svg: full, mono-dark, mono-light) icon/ (png set + svg) tray/ (template svgs)
      readme-banner.svg (1280×640) social-preview.png (1280×640)
  DESIGN-NOTES.md         # palette, type scale, spacing, contrast table, motion table, decisions
```

**Rules for the template code**
- One component per file, named exports, props typed with the §7 types.
- No hard-coded colours/sizes in components — tokens only.
- Every interactive element reachable by keyboard and labelled.
- Zero console errors/warnings; `tsc --noEmit` clean; no `any`.

---

## 12. Acceptance checklist

- [ ] Gallery shows every surface (S1–S7) and every state listed in §5–§6.
- [ ] Toggles for theme (dark/light), material (glass/solid), platform (mac/win/linux), locale (en/it), reduced motion all work everywhere.
- [ ] Italian copy fits without truncating essential information.
- [ ] Types in `src/types/ui.ts` match §7 exactly.
- [ ] Tokens in `tokens.css` match §4 names; Tailwind `@theme` mapping present.
- [ ] Contrast table in `DESIGN-NOTES.md` proves AA.
- [ ] Orb pauses animation when the document is hidden.
- [ ] Assets: logo set, app icon set, tray templates, README banner, social preview.
- [ ] `pnpm dev`, `pnpm build`, `tsc --noEmit` all succeed.
