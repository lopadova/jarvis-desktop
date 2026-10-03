/**
 * Turn pipeline (product-spec §4.2):
 *   pending approval yes/no → pending jarvis_ask_user answer → fast path → brain router
 *   (structured JSON, one repair retry) → grounding (R4) → side effects (remember/forget by id) →
 *   execute → speak → record turn + chat.
 * Turns are serialised (one router call at a time). A stop/Esc bumps the epoch: in-flight results of
 * older turns are dropped and the clarify context is reset.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AgentId,
  type BrainImage,
  type BrainMessage,
  type BrainProvider,
  type BrainRequest,
  briefingTask,
  type ChatMessage,
  type ContentSource,
  contentJsonSchema,
  contentSystemPrompt,
  contentUserPrompt,
  enforceGrounding,
  type FastIntent,
  isTaskGrounded,
  type Logger,
  locationMemory,
  MAX_SCREENSHOT_BASE64,
  matchContentSource,
  matchFastIntent,
  type Project,
  ProviderError,
  parseContentReply,
  parseRouterAction,
  phrases,
  REPAIR_PROMPT,
  type RouterAction,
  type RouterContext,
  routerJsonSchema,
  routerSystemPrompt,
  routerUserPrompt,
  type Settings,
  type SystemCardData,
  spokenDuration,
  spokenList,
  type Turn,
  toSessionView,
} from '@jarvis/core';
import type { ApprovalBroker } from './approvals.js';
import type { HostClient, UiSink } from './host.js';
import type { MemoryService } from './memory-service.js';
import { extraPhrases } from './phrases-extra.js';
import type { Pill } from './pill.js';
import { type BrainRegistry, LOCAL_BRAINS } from './providers-contract.js';
import { nextClockTime, type ReminderScheduler } from './reminders.js';
import type { SessionManager } from './sessions.js';
import type { Store } from './store/store.js';
import { errorMessage, expandHome, newId, slug } from './util.js';
import { type Openable, safeOpenable } from './viewable.js';
import type { VoiceOutput } from './voice/output.js';
import { ReplySpeechStream } from './voice/reply-stream.js';

export type TurnSource = 'voice' | 'text' | 'chip';

/** The user explicitly asks to forget something (EN/IT). */
export const FORGET_INTENT =
  /\b(forget|don'?t remember|stop remembering|remove .*memor|delete .*memor|dimentica|dimenticati|non ricordare|scordati|cancella .*memoria|togli .*memoria)\b/i;

export interface OrchestratorDeps {
  store: Store;
  settings: () => Settings;
  updateSettings: (patch: Partial<Settings>) => Settings;
  logger: Logger;
  ui: UiSink;
  host: HostClient;
  pill: Pill;
  voice: VoiceOutput;
  brains: BrainRegistry;
  sessions: SessionManager;
  approvals: ApprovalBroker;
  reminders: ReminderScheduler;
  memory: MemoryService;
  availableAgents: () => Promise<AgentId[]>;
  onProvidersChanged?: () => void;
  now?: () => number;
  timeZone?: string;
}

interface PendingAsk {
  resolve: (answer: string | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** How long dictation mode waits for the utterance to type. */
export const DICTATION_TIMEOUT_MS = 60_000;
/** Brains tried, in order, when the primary one cannot see images (never a pay-per-use API: R10). */
const VISION_FALLBACKS = ['chatgpt', 'local'] as const;

interface ReplyOptions {
  /** Shown/spoken but never written to the database (captured clipboard/screen derivatives, dictation). */
  ephemeral?: boolean;
  /** With `ephemeral`: do not even record that the turn happened (e.g. "delete today's history"). */
  noRecord?: boolean;
}

export type BrainPick = { ok: true; brain: BrainProvider } | { ok: false; message: string };

export class Orchestrator {
  private chain: Promise<void> = Promise.resolve();
  private epoch = 0;
  private inflight: AbortController | null = null;
  private clarifyContext: string | undefined;
  private pendingAsk: PendingAsk | null = null;
  private dictationTimer: ReturnType<typeof setTimeout> | null = null;
  /** Last full text produced from clipboard/screen content, for "copy it" (memory only, never persisted). */
  private lastResult: string | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: OrchestratorDeps) {
    this.now = deps.now ?? Date.now;
  }

  get clarifying(): string | undefined {
    return this.clarifyContext;
  }

  /** True while the next utterance will be typed into the active app instead of answered. */
  get dictating(): boolean {
    return this.dictationTimer !== null;
  }

  /** Entry point for typed text, chips and final voice transcripts. Resolves when the turn is done. */
  submit(text: string, source: TurnSource): Promise<void> {
    const clean = text.trim();
    if (!clean) return Promise.resolve();
    if (this.dictating) return this.dictate(clean, source);
    this.chat({ id: newId('u_'), role: 'user', text: clean, at: this.now(), viaVoice: source === 'voice' });
    if (this.deps.approvals.handleUtterance(clean)) return Promise.resolve();
    if (this.pendingAsk) {
      const ask = this.pendingAsk;
      this.pendingAsk = null;
      clearTimeout(ask.timer);
      this.deps.pill.clearSticky('clarify');
      ask.resolve(clean);
      return Promise.resolve();
    }
    // Stop phrases are handled immediately, even while another turn is thinking.
    const fast = matchFastIntent(clean);
    if (fast?.kind === 'stop-speaking') {
      this.stop();
      this.record({ at: this.now(), heard: clean, said: '', action: 'fast:stop' });
      return Promise.resolve();
    }
    const epoch = this.epoch;
    const run = this.chain.then(() => this.runTurn(clean, epoch, fast));
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Esc / "stop": stop speaking, drop in-flight router results, reset the clarify context. */
  stop(): void {
    this.epoch++;
    this.inflight?.abort();
    this.inflight = null;
    this.clarifyContext = undefined;
    this.endDictation();
    this.deps.voice.stop();
    this.deps.pill.clearSticky('clarify');
    this.deps.pill.set({ kind: 'hidden' });
    this.deps.voice.setListening('idle');
  }

  /** `jarvis_ask_user`: shows a clarify pill, speaks, resolves with the next utterance/click or null on timeout. */
  ask(question: string, options: string[], timeoutMs: number): Promise<string | null> {
    if (this.pendingAsk) {
      clearTimeout(this.pendingAsk.timer);
      this.pendingAsk.resolve(null);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingAsk?.timer === timer) {
          this.pendingAsk = null;
          this.deps.pill.clearSticky('clarify');
        }
        resolve(null);
      }, timeoutMs);
      timer.unref?.();
      this.pendingAsk = { resolve, timer };
      this.deps.pill.setSticky({ kind: 'clarify', question, quickReplies: options.slice(0, 4) });
      this.jarvisSays(question);
    });
  }

  /** Primary brain, honouring private mode (only local brains when on). */
  pickBrain(): BrainPick {
    const s = this.deps.settings();
    const p = phrases(s.locale);
    const x = extraPhrases(s.locale);
    const id = s.primaryBrain;
    if (!id) return { ok: false, message: s.privateMode ? x.privateNoBrain : p.noBrain };
    const brain = this.deps.brains.get(id);
    if (s.privateMode && !LOCAL_BRAINS.includes(id)) {
      return { ok: false, message: x.privateBlocked(brain?.label ?? id) };
    }
    if (!brain) return { ok: false, message: p.noBrain };
    return { ok: true, brain };
  }

  /**
   * A brain that can look at images. The primary one when it can (private mode: local only); otherwise a
   * connected subscription/local vision brain. Never switches to a pay-per-use API on its own (R10).
   */
  async pickVisionBrain(): Promise<BrainPick> {
    const s = this.deps.settings();
    const p = phrases(s.locale);
    const pick = this.pickBrain();
    if (!pick.ok) return pick;
    if (pick.brain.vision) return pick;
    if (!s.privateMode) {
      for (const id of VISION_FALLBACKS) {
        const b = this.deps.brains.get(id);
        if (!b?.vision || b.id === pick.brain.id) continue;
        try {
          const st = await b.status();
          if (st.connected && st.state === 'ok') return { ok: true, brain: b };
        } catch {
          /* not usable */
        }
      }
    }
    return { ok: false, message: p.screenNoVision(pick.brain.label) };
  }

  // ───────── internals ─────────

  private async runTurn(text: string, epoch: number, fast: FastIntent | null): Promise<void> {
    if (epoch !== this.epoch) return;
    try {
      const source = fast ? null : matchContentSource(text);
      if (fast) await this.fastPath(fast, text);
      else if (source) await this.content(source, text, epoch);
      else await this.routed(text, epoch);
    } catch (e) {
      this.deps.logger.error('turn failed', { error: e });
      await this.reply(text, phrases(this.deps.settings().locale).brainError, 'error');
    }
  }

  private async routed(text: string, epoch: number): Promise<void> {
    const s = this.deps.settings();
    const p = phrases(s.locale);
    const pick = this.pickBrain();
    if (!pick.ok) {
      await this.reply(text, pick.message, 'no-brain');
      return;
    }
    const brain = pick.brain;
    const userText = this.clarifyContext ? `${this.clarifyContext} ${text}` : text;
    this.deps.pill.set({ kind: 'thinking', transcript: text, brain: brain.id });
    this.deps.voice.setListening('busy');

    const ctx: RouterContext = {
      now: new Date(this.now()),
      locale: s.locale,
      timeZone: this.deps.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      projects: this.deps.store.listProjects(),
      sessions: this.deps.sessions.list(),
      memories: this.deps.memory.list(),
      turns: this.deps.store.recentTurns(10),
      maxSessions: s.maxConcurrentSessions,
      availableAgents: await this.deps.availableAgents(),
    };
    if (s.userName) ctx.userName = s.userName;
    if (this.clarifyContext) ctx.clarifyContext = this.clarifyContext;

    const messages: BrainMessage[] = [
      { role: 'system', content: routerSystemPrompt(s.locale) },
      { role: 'user', content: routerUserPrompt(ctx, text) },
    ];
    const abort = new AbortController();
    this.inflight = abort;
    let action: RouterAction | null = null;
    // Streaming TTS: safe `speak` sentences of answer/clarify/status replies start before the JSON ends.
    const speech = s.speakReplies && !this.deps.voice.muted ? new ReplySpeechStream(this.deps.voice) : null;
    try {
      const first = await brain.complete({
        messages,
        jsonSchema: routerJsonSchema,
        tier: 'fast',
        signal: abort.signal,
        ...(speech
          ? {
              onDelta: (d: string) => {
                if (epoch === this.epoch && !abort.signal.aborted) speech.push(d);
              },
            }
          : {}),
      });
      let parsed = parseRouterAction(first.json ?? first.text);
      // Never keep speaking a reply that failed validation or turned out to be another action.
      if (speech && (!parsed.ok || parsed.action.action !== speech.committedAction)) speech.cancel();
      if (!parsed.ok && epoch === this.epoch) {
        this.deps.logger.warn('router reply invalid, repairing', { error: parsed.error });
        const repair: BrainMessage[] = [
          ...messages,
          { role: 'assistant', content: first.text.slice(0, 4000) },
          { role: 'user', content: REPAIR_PROMPT },
        ];
        const second = await brain.complete({
          messages: repair,
          jsonSchema: routerJsonSchema,
          tier: 'fast',
          signal: abort.signal,
        });
        parsed = parseRouterAction(second.json ?? second.text);
      }
      if (parsed.ok) action = parsed.action;
    } catch (e) {
      speech?.cancel();
      if (epoch !== this.epoch || abort.signal.aborted) return;
      await this.brainFailure(text, brain, e);
      return;
    } finally {
      if (this.inflight === abort) this.inflight = null;
    }
    if (epoch !== this.epoch) {
      speech?.cancel();
      return; // a newer stop/Esc dropped this result
    }
    if (!action) {
      await this.reply(text, p.brainError, 'invalid');
      return;
    }

    // R4: actions that start work must be grounded in the user's own words.
    const g = enforceGrounding(action, userText);
    if (g.rejected) {
      this.deps.logger.warn('router action rejected by grounding check', { reason: g.rejected });
      action = { ...g.action, speak: p.notGrounded, quickReplies: null };
    }

    // Memory side effects (R4/R12): only when grounded in what the user actually said.
    const memoryDropped = g.rejected ? !!action.remember : this.applyMemoryEffects(action, userText);
    if (memoryDropped && /\b(remember|noted|memor|ricord|annotat)/i.test(action.speak)) {
      // Never claim to have remembered something that was not saved.
      action = { ...action, speak: p.notGrounded };
    }

    this.clarifyContext = action.action === 'clarify' ? userText.slice(-1000) : undefined;
    if (action.action !== 'clarify') this.deps.pill.clearSticky('clarify');
    await this.execute(action, text, speech?.started ? speech : undefined);
  }

  /**
   * Clipboard / screen questions. The captured content goes to the brain as untrusted data (R4) — the
   * reply is only spoken and shown, never parsed into an action — and nothing captured is persisted:
   * the clipboard text and the screenshot live in this call only, the result is shown ephemerally.
   */
  private async content(source: ContentSource, text: string, epoch: number): Promise<void> {
    const s = this.deps.settings();
    const p = phrases(s.locale);
    const action = `content:${source}`;
    let pick: BrainPick;
    let clipboard: string | undefined;
    let images: BrainImage[] | undefined;
    if (source === 'screen') {
      if (!s.screenAccess) {
        await this.reply(text, p.screenOff, `${action}:off`);
        return;
      }
      // Pick the brain before capturing: nothing is captured when it could not be sent (private mode, no vision).
      pick = await this.pickVisionBrain();
      if (!pick.ok) {
        await this.reply(text, pick.message, `${action}:no-brain`);
        return;
      }
      if (!this.deps.host.connected) {
        await this.reply(text, p.screenFailed, `${action}:failed`);
        return;
      }
      this.deps.pill.set({ kind: 'thinking', transcript: text, brain: pick.brain.id });
      this.deps.voice.setListening('busy');
      try {
        const shot = await this.deps.host.call('host.screenshot', {});
        if (!shot.pngBase64 || shot.pngBase64.length > MAX_SCREENSHOT_BASE64) throw new Error('screenshot too large');
        images = [{ mime: 'image/png', base64: shot.pngBase64 }];
      } catch (e) {
        this.deps.logger.warn('screenshot failed', { error: errorMessage(e) });
        await this.reply(text, p.screenFailed, `${action}:failed`);
        return;
      }
    } else {
      pick = this.pickBrain();
      if (!pick.ok) {
        await this.reply(text, pick.message, `${action}:no-brain`);
        return;
      }
      try {
        if (!this.deps.host.connected) throw new Error('shell not connected');
        clipboard = (await this.deps.host.call('host.clipboard.read', {})).text ?? '';
      } catch (e) {
        this.deps.logger.warn('clipboard read failed', { error: errorMessage(e) });
        await this.reply(text, p.clipboardUnavailable, `${action}:failed`);
        return;
      }
      if (!clipboard.trim()) {
        await this.reply(text, p.clipboardEmpty, `${action}:empty`);
        return;
      }
      this.deps.pill.set({ kind: 'thinking', transcript: text, brain: pick.brain.id });
      this.deps.voice.setListening('busy');
    }
    if (epoch !== this.epoch) return;

    const brain = pick.brain;
    const abort = new AbortController();
    this.inflight = abort;
    const req: BrainRequest = {
      messages: [
        { role: 'system', content: contentSystemPrompt(s.locale, source) },
        { role: 'user', content: contentUserPrompt(text, source, clipboard) },
      ],
      jsonSchema: contentJsonSchema,
      tier: 'smart',
      signal: abort.signal,
    };
    if (images) req.images = images;
    let answer: ReturnType<typeof parseContentReply> = null;
    try {
      const res = await brain.complete(req);
      answer = parseContentReply(res.json, res.text);
    } catch (e) {
      if (epoch !== this.epoch || abort.signal.aborted) return;
      if (source === 'screen' && e instanceof ProviderError && e.code === 'not-configured') {
        this.deps.logger.warn('vision request refused', { brain: brain.id, error: e.message });
        await this.reply(text, p.screenNoVision(brain.label), `${action}:no-vision`);
        return;
      }
      await this.brainFailure(text, brain, e);
      return;
    } finally {
      if (this.inflight === abort) this.inflight = null;
      // Drop the captured data as soon as the request is over.
      clipboard = undefined;
      images = undefined;
      req.images = undefined;
    }
    if (epoch !== this.epoch) return;
    if (!answer) {
      await this.reply(text, p.brainError, `${action}:invalid`);
      return;
    }
    if (answer.result && answer.result !== answer.speak) {
      this.lastResult = answer.result.slice(0, 20_000);
      this.card({ type: 'text-result', source, text: this.lastResult }, { ephemeral: true });
    } else this.lastResult = answer.speak;
    await this.reply(text, answer.speak, action, {}, undefined, { ephemeral: true });
  }

  /**
   * `remember` is saved only when its wording is grounded in the user's own words; `forget` only when
   * the utterance expresses a forget intent and the id exists. Anything else is dropped and logged.
   */
  private applyMemoryEffects(action: RouterAction, userText: string): boolean {
    let dropped = false;
    if (action.remember) {
      const g = isTaskGrounded(action.remember, userText);
      if (g.ok) this.deps.memory.add(action.remember);
      else {
        dropped = true;
        this.deps.logger.warn('remember dropped: not grounded in the utterance', { reason: g.reason });
      }
    }
    const id = action.forget?.memoryId;
    if (id) {
      const exists = this.deps.memory.list().some((m) => m.id === id);
      if (exists && FORGET_INTENT.test(userText)) this.deps.memory.forget(id);
      else this.deps.logger.warn('forget dropped', { exists, intent: FORGET_INTENT.test(userText) });
    }
    return dropped;
  }

  private async brainFailure(text: string, brain: BrainProvider, e: unknown): Promise<void> {
    const p = phrases(this.deps.settings().locale);
    if (e instanceof ProviderError) {
      if (e.code === 'cap-reached') {
        // R10: tell the user; never switch to a paid API automatically.
        this.deps.onProvidersChanged?.();
        await this.reply(text, p.capReached(brain.label), 'cap-reached');
        return;
      }
      if (e.code === 'needs-login') {
        this.deps.onProvidersChanged?.();
        await this.reply(text, p.needsLogin(brain.label), 'needs-login');
        return;
      }
    }
    this.deps.logger.warn('brain call failed', { brain: brain.id, error: errorMessage(e) });
    await this.reply(text, p.brainError, 'error');
  }

  private resolveProject(name: string | null | undefined): Project | null {
    if (!name) return null;
    const n = name.trim().toLowerCase();
    return (
      this.deps.store
        .listProjects()
        .find((p) => p.name.toLowerCase() === n || p.aliases.some((a) => a.toLowerCase() === n)) ?? null
    );
  }

  private async execute(a: RouterAction, heard: string, speech?: ReplySpeechStream): Promise<void> {
    const s = this.deps.settings();
    const p = phrases(s.locale);
    const x = extraPhrases(s.locale);
    const meta = { task: a.task ?? undefined, project: a.project ?? undefined };
    switch (a.action) {
      case 'answer':
      case 'status':
        await this.reply(heard, a.speak || p.brainError, a.action, meta, speech);
        return;
      case 'clarify': {
        const question = a.speak || p.notGrounded;
        this.deps.pill.setSticky({ kind: 'clarify', question, quickReplies: a.quickReplies ?? [] });
        await this.reply(heard, question, 'clarify', meta, speech);
        return;
      }
      case 'create_project': {
        const name = (a.project ?? '').trim();
        if (!name || !a.task) {
          await this.reply(heard, p.whatShouldItDo, 'clarify');
          return;
        }
        let project = this.resolveProject(name);
        if (!project) {
          const path = join(expandHome(s.projectsRoot), slug(name));
          mkdirSync(path, { recursive: true });
          project = {
            id: newId('p_'),
            name: name.slice(0, 80),
            path,
            aliases: [],
            defaultAgent: s.defaultAgent,
            permission: 'safe',
            allowlist: [],
          };
          this.deps.store.upsertProject(project);
        }
        await this.spawn(a, heard, project);
        return;
      }
      case 'spawn':
        await this.spawn(a, heard, this.resolveProject(a.project));
        return;
      case 'followup': {
        const id = a.sessionId ?? '';
        const r = this.deps.sessions.followup(id, a.task ?? heard);
        const line =
          r === 'queued'
            ? a.speak || x.queued
            : r === 'resumed'
              ? a.speak || p.started(this.deps.sessions.get(id)?.project ?? '')
              : r === 'limit'
                ? p.tooManySessions(s.maxConcurrentSessions)
                : x.unknownSession;
        await this.reply(heard, line, 'followup', meta);
        return;
      }
      case 'cancel': {
        if (!a.sessionId || a.sessionId === '*') {
          const n = this.deps.sessions.stopAll();
          await this.reply(heard, n ? p.stoppedAll : p.nothingRunning, 'cancel');
        } else {
          const ok = this.deps.sessions.stop(a.sessionId);
          await this.reply(heard, ok ? a.speak || p.stopped : x.unknownSession, 'cancel');
        }
        return;
      }
      case 'open': {
        const session = a.sessionId ? this.deps.sessions.get(a.sessionId) : undefined;
        const project = this.resolveProject(a.project);
        // Only the session's own safe result (localhost URL / file inside its folder) or a registered folder.
        const target: Openable | undefined = session
          ? (safeOpenable(session.resultUrl, session.cwd) ?? { target: session.cwd, kind: 'path' })
          : project
            ? { target: project.path, kind: 'path' }
            : undefined;
        if (!target || !this.deps.host.connected) {
          await this.reply(heard, x.nothingToOpen, 'open');
          return;
        }
        await this.deps.host.call('host.open', target).catch(() => undefined);
        await this.reply(heard, a.speak || x.opened, 'open', meta);
        return;
      }
      case 'reminder': {
        const r = a.reminder;
        const due = r ? Date.parse(r.dueAt) : Number.NaN;
        if (!r || !Number.isFinite(due)) {
          await this.reply(heard, p.brainError, 'reminder');
          return;
        }
        const rem = this.deps.reminders.add(r.text, due, r.kind ?? 'reminder');
        this.card({ type: 'reminder-set', text: rem.text, dueAt: rem.dueAt });
        const line = a.speak || p.reminderSet(spokenDuration((due - this.now()) / 1000, s.locale), rem.text);
        await this.reply(heard, line, 'reminder', meta);
        return;
      }
    }
  }

  private async spawn(a: RouterAction, heard: string, project: Project | null): Promise<void> {
    const s = this.deps.settings();
    const p = phrases(s.locale);
    const task = (a.task ?? '').trim();
    if (!task) {
      this.clarifyContext = heard;
      await this.reply(heard, p.whatShouldItDo, 'clarify');
      return;
    }
    const available = await this.deps.availableAgents();
    let agent: AgentId = a.agent ?? project?.defaultAgent ?? s.defaultAgent;
    if (!available.includes(agent)) {
      if (!a.agent && !a.coding && available.includes('home')) agent = 'home';
      else if (!a.agent && available.length) agent = available[0] as AgentId;
      else {
        await this.reply(heard, available.length ? p.agentMissing(agent) : p.noAgent, 'spawn');
        return;
      }
    }
    if (project && !existsSync(project.path)) {
      await this.reply(heard, p.folderMissing(project.name), 'spawn');
      return;
    }
    const r = this.deps.sessions.start({ agent, project, task, coding: !!a.coding, origin: 'voice' });
    if (!r.ok) {
      const line =
        r.reason === 'limit'
          ? p.tooManySessions(s.maxConcurrentSessions)
          : r.reason === 'folder-missing'
            ? p.folderMissing(project?.name ?? '')
            : p.agentMissing(agent);
      await this.reply(heard, line, 'spawn');
      return;
    }
    this.card({ type: 'session-started', session: toSessionView(r.session) });
    await this.reply(heard, a.speak || p.started(r.session.project), a.action, { task, project: r.session.project });
  }

  private async fastPath(f: FastIntent, heard: string): Promise<void> {
    const s = this.deps.settings();
    const p = phrases(s.locale);
    const loc = s.locale === 'it' ? 'it-IT' : 'en-GB';
    const action = `fast:${f.kind}`;
    switch (f.kind) {
      case 'stop-speaking':
        this.stop();
        return;
      case 'cancel-all': {
        const n = this.deps.sessions.stopAll();
        await this.reply(heard, n ? p.stoppedAll : p.nothingRunning, action);
        return;
      }
      case 'status':
        await this.reply(heard, this.statusLine(), action);
        return;
      case 'repeat':
        await this.reply(heard, this.deps.voice.lastSpoken || p.nothingToRepeat, action);
        return;
      case 'timer': {
        const endsAt = this.now() + f.seconds * 1000;
        this.deps.reminders.add(f.label, endsAt, 'timer');
        this.card({ type: 'timer', label: f.label, endsAt });
        await this.reply(heard, p.timerSet(spokenDuration(f.seconds, s.locale)), action);
        return;
      }
      case 'alarm': {
        const at = nextClockTime(f.at.hour, f.at.minute, new Date(this.now()));
        this.deps.reminders.add('alarm', at, 'alarm');
        const hhmm = `${String(f.at.hour).padStart(2, '0')}:${String(f.at.minute).padStart(2, '0')}`;
        this.card({ type: 'reminder-set', text: hhmm, dueAt: at });
        await this.reply(heard, p.alarmSet(hhmm), action);
        return;
      }
      case 'reminder': {
        const due = this.now() + f.inSeconds * 1000;
        this.deps.reminders.add(f.text, due, 'reminder');
        this.card({ type: 'reminder-set', text: f.text, dueAt: due });
        await this.reply(heard, p.reminderSet(spokenDuration(f.inSeconds, s.locale), f.text), action);
        return;
      }
      case 'time':
        await this.reply(
          heard,
          p.time(new Intl.DateTimeFormat(loc, { timeStyle: 'short' }).format(new Date(this.now()))),
          action,
        );
        return;
      case 'date':
        await this.reply(
          heard,
          p.date(new Intl.DateTimeFormat(loc, { dateStyle: 'full' }).format(new Date(this.now()))),
          action,
        );
        return;
      case 'private-mode':
        this.deps.updateSettings({ privateMode: f.on });
        await this.reply(heard, f.on ? p.privateOn : p.privateOff, action);
        return;
      case 'open-settings':
        if (this.deps.host.connected)
          await this.deps.host.call('host.showWindow', { window: 'settings' }).catch(() => undefined);
        this.record({ at: this.now(), heard, said: '', action });
        return;
      case 'dictate': {
        if (!this.deps.host.connected) {
          await this.reply(heard, p.dictationNoShell, action);
          return;
        }
        await this.reply(heard, p.dictationOn, action);
        this.startDictation();
        return;
      }
      case 'dictate-stop':
        // Only reached when not dictating (an active dictation handles its own stop phrases).
        await this.reply(heard, p.dictationIdle, action);
        return;
      case 'copy-result': {
        if (!this.lastResult) {
          await this.reply(heard, p.nothingToCopy, action);
          return;
        }
        const ok = this.deps.host.connected
          ? await this.deps.host
              .call('host.clipboard.write', { text: this.lastResult })
              .then(() => true)
              .catch(() => false)
          : false;
        await this.reply(heard, ok ? p.copied : p.clipboardUnavailable, action);
        return;
      }
      case 'shopping-add': {
        const added = this.deps.store.addShopping(f.items, () => newId('s_'), this.now());
        const items = this.publishShopping();
        if (!added.length) {
          await this.reply(heard, p.shoppingAlready(spokenList(f.items, s.locale)), action);
          return;
        }
        const names = added.map((i) => i.text);
        this.card({ type: 'shopping', items, added: names });
        await this.reply(heard, p.shoppingAdded(spokenList(names, s.locale)), action);
        return;
      }
      case 'shopping-remove': {
        const removed = this.deps.store.removeShoppingByText(f.items);
        if (!removed.length) {
          await this.reply(heard, p.shoppingNotFound(spokenList(f.items, s.locale)), action);
          return;
        }
        const items = this.publishShopping();
        const names = removed.map((i) => i.text);
        this.card({ type: 'shopping', items, removed: names });
        await this.reply(heard, p.shoppingRemoved(spokenList(names, s.locale)), action);
        return;
      }
      case 'shopping-list': {
        const items = this.deps.store.listShopping();
        if (!items.length) {
          await this.reply(heard, p.shoppingEmpty, action);
          return;
        }
        this.card({ type: 'shopping', items });
        const names = items.slice(0, 12).map((i) => i.text);
        await this.reply(heard, p.shoppingList(items.length, spokenList(names, s.locale)), action);
        return;
      }
      case 'shopping-clear': {
        const n = this.deps.store.clearShopping();
        this.publishShopping();
        await this.reply(heard, n ? p.shoppingCleared : p.shoppingEmpty, action);
        return;
      }
      case 'forget-today': {
        // Clear first (this request included), then confirm without writing anything new.
        this.clearHistory('today');
        await this.reply(heard, p.todayForgotten, action, {}, undefined, { ephemeral: true, noRecord: true });
        return;
      }
      case 'what-you-know': {
        const list = this.deps.memory.list();
        this.deps.ui.emit('ui.navigate', { view: 'memory' });
        if (this.deps.host.connected)
          void this.deps.host.call('host.showWindow', { window: 'home' }).catch(() => undefined);
        if (!list.length) {
          await this.reply(heard, p.memoryNone, action);
          return;
        }
        const latest = list
          .slice(-5)
          .reverse()
          .map((m) => m.text.replace(/[.;\s]+$/, ''));
        await this.reply(heard, p.memorySummary(list.length, latest.join('; '), Math.max(0, list.length - 5)), action);
        return;
      }
      case 'briefing':
        await this.briefing(heard);
        return;
    }
  }

  /** Clears turns + chat since the start of today (or everything) and tells the UI. */
  clearHistory(scope: 'today' | 'all'): void {
    const d = new Date(this.now());
    d.setHours(0, 0, 0, 0);
    const since = scope === 'today' ? d.getTime() : 0;
    this.deps.store.clearHistory(since);
    this.deps.ui.emit('ui.history', { since });
  }

  private publishShopping() {
    const items = this.deps.store.listShopping();
    this.deps.ui.emit('ui.shopping', { items });
    return items;
  }

  // ───────── dictation ─────────

  private startDictation(): void {
    this.endDictation();
    this.dictationTimer = setTimeout(() => this.endDictation(), DICTATION_TIMEOUT_MS);
    this.dictationTimer.unref?.();
    this.deps.pill.setSticky({ kind: 'listening', level: 0, partial: '', committed: '', dictation: true });
    // Keep the microphone open for the dictated sentence even when conversation mode is off.
    this.deps.voice.setListening('conversation', 15_000);
  }

  private endDictation(): void {
    if (!this.dictationTimer) return;
    clearTimeout(this.dictationTimer);
    this.dictationTimer = null;
    this.deps.pill.clearSticky('listening');
  }

  /** The utterance after "dictate": typed into the active app (never sent to a brain, never stored). */
  private async dictate(text: string, source: TurnSource): Promise<void> {
    const p = phrases(this.deps.settings().locale);
    const f = matchFastIntent(text);
    this.endDictation();
    if (f?.kind === 'dictate-stop' || f?.kind === 'stop-speaking' || f?.kind === 'cancel-all') {
      this.deps.voice.stop();
      await this.reply(text, p.dictationCancelled, 'fast:dictate-stop');
      return;
    }
    this.chat({ id: newId('u_'), role: 'user', text, at: this.now(), viaVoice: source === 'voice' }, false);
    this.deps.pill.set({ kind: 'hidden' });
    try {
      if (!this.deps.host.connected) throw new Error('shell not connected');
      await this.deps.host.call('host.typeText', { text });
      this.record({ at: this.now(), heard: '[dictation]', said: '', action: 'fast:dictation-typed' });
    } catch (e) {
      this.deps.logger.warn('typing failed', { error: errorMessage(e) });
      await this.reply('[dictation]', p.dictationNoShell, 'fast:dictation-failed', {}, undefined, { ephemeral: true });
    }
  }

  // ───────── morning briefing ─────────

  private async briefing(heard: string): Promise<void> {
    const s = this.deps.settings();
    const p = phrases(s.locale);
    const available = await this.deps.availableAgents();
    const agent: AgentId | undefined = available.includes('home')
      ? 'home'
      : available.includes(s.defaultAgent)
        ? s.defaultAgent
        : available[0];
    if (!agent) {
      await this.reply(heard, p.noAgent, 'fast:briefing');
      return;
    }
    const location = locationMemory(this.deps.memory.list())?.text;
    const task = briefingTask(s.locale, {
      now: new Date(this.now()),
      timeZone: this.deps.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(location ? { location } : {}),
    });
    const r = this.deps.sessions.start({
      agent,
      project: null,
      task,
      coding: false,
      origin: 'voice',
      purpose: 'briefing',
    });
    if (!r.ok) {
      await this.reply(
        heard,
        r.reason === 'limit' ? p.tooManySessions(s.maxConcurrentSessions) : p.agentMissing(agent),
        'fast:briefing',
      );
      return;
    }
    this.card({ type: 'session-started', session: toSessionView(r.session) });
    await this.reply(heard, p.briefingStarted, 'fast:briefing', { task: 'morning briefing' });
  }

  private statusLine(): string {
    const s = this.deps.settings();
    const p = phrases(s.locale);
    const live = this.deps.sessions
      .list()
      .filter((x) => x.status === 'running' || x.status === 'needs-input' || x.status === 'approval');
    if (!live.length) return p.nothingRunning;
    const parts = live.slice(0, 3).map((x) => `${x.project}: ${(x.activity ?? x.status).replace(/[.!]+$/, '')}`);
    return s.locale === 'it'
      ? `${live.length === 1 ? 'Un lavoro in corso' : `${live.length} lavori in corso`}. ${parts.join('; ')}.`
      : `${live.length === 1 ? 'One thing running' : `${live.length} things running`}. ${parts.join('; ')}.`;
  }

  // ───────── output helpers ─────────

  /** `persist: false` shows the message without storing it (it disappears on reload). */
  chat(m: ChatMessage, persist = true): void {
    if (persist) this.deps.store.addChat(m);
    this.deps.ui.emit('ui.chat', { message: m });
  }

  card(card: SystemCardData, opts: ReplyOptions = {}): void {
    this.chat({ id: newId('c_'), role: 'system', card, at: this.now() }, !opts.ephemeral);
  }

  private record(t: Turn): void {
    this.deps.store.addTurn(t);
  }

  /** Jarvis line outside a turn (ask_user, MCP speak). */
  jarvisSays(text: string, ephemeral = false): Promise<void> {
    const s = this.deps.settings();
    const spoken = s.speakReplies && !this.deps.voice.muted;
    this.chat({ id: newId('j_'), role: 'jarvis', text, at: this.now(), spoken }, !ephemeral);
    return spoken ? this.deps.voice.speak(text) : Promise.resolve();
  }

  private async reply(
    heard: string,
    said: string,
    action: string,
    meta: { task?: string | undefined; project?: string | undefined } = {},
    speech?: ReplySpeechStream,
    opts: ReplyOptions = {},
  ): Promise<void> {
    if (opts.ephemeral) {
      // History keeps that the request happened, never what was derived from captured content.
      if (!opts.noRecord) this.record({ at: this.now(), heard, said: '', action });
    } else {
      const turn: Turn = { at: this.now(), heard, said, action };
      if (meta.task) turn.task = meta.task;
      if (meta.project) turn.project = meta.project;
      this.record(turn);
    }
    if (this.deps.pill.state.kind === 'thinking') this.deps.pill.set({ kind: 'hidden' });
    if (speech?.started) {
      // The beginning is already being spoken: record the line and say only what is missing.
      this.chat({ id: newId('j_'), role: 'jarvis', text: said, at: this.now(), spoken: true }, !opts.ephemeral);
      await speech.finish(said);
    } else await this.jarvisSays(said, opts.ephemeral);
    if (!this.deps.voice.busy)
      this.deps.voice.setListening(this.deps.settings().conversationMode ? 'conversation' : 'idle');
  }
}
