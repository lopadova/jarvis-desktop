/**
 * Session manager: starts agent runs, enforces the concurrency limit (counting every *live* status:
 * running, needs-input and approval), queues follow-ups while a run is busy (cleared on cancel /
 * stop-all, R8), resumes via the agent-side session id, writes a per-session NDJSON log, detects
 * viewable results, narrates progress and announces completion.
 */
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import {
  type AgentDriver,
  type AgentEvent,
  type AgentId,
  isLive,
  type Logger,
  type PermissionLevel,
  type Project,
  phrases,
  type Session,
  type SessionView,
  type Settings,
  spokenDuration,
  toSessionView,
} from '@jarvis/core';
import type { HostRunOptions } from './agents/common.js';
import type { ApprovalBroker } from './approvals.js';
import type { HostClient, UiSink } from './host.js';
import type { McpSessionTokens } from './mcp-tokens.js';
import type { ProcessInspector } from './process/proc.js';
import type { Store } from './store/store.js';
import { errorMessage, newId } from './util.js';
import { detectViewable, safeOpenable } from './viewable.js';

export const PROGRESS_FIRST_MS = 20_000;
export const PROGRESS_EVERY_MS = 45_000;
const PROGRESS_GLOBAL_GAP_MS = 15_000;
const RESULT_MAX = 20_000;

export interface SessionDeps {
  store: Store;
  drivers: Partial<Record<AgentId, AgentDriver>>;
  approvals: ApprovalBroker;
  host: HostClient;
  ui: UiSink;
  settings: () => Settings;
  logger: Logger;
  dataDir: string;
  inspector: ProcessInspector;
  speak: (text: string) => Promise<void>;
  /** True while the user talks, Jarvis speaks, or DND mutes output: progress narration waits. */
  isQuiet: () => boolean;
  /** One spoken sentence for a finished session (brain, with phrase fallback). */
  summarize: (s: Session) => Promise<string>;
  /** Standing preferences (memories) appended to every agent's guidance. */
  guidance: () => string;
  generalWorkspace: () => string;
  /** Custom announcement for special-purpose runs (e.g. the briefing card); returns the line to speak. */
  announcePurpose?: (s: Session, purpose: SessionPurpose) => Promise<string | null>;
  /** Issues/revokes per-session MCP tokens (verified caller identity). */
  tokens?: McpSessionTokens;
  now?: () => number;
}

export interface StartRequest {
  agent: AgentId;
  project: Project | null;
  task: string;
  coding: boolean;
  origin?: string;
  /** Upper bound for the permission level (tasks started by another agent never escalate). */
  permissionCap?: PermissionLevel;
  /** Special-purpose run whose result is announced by `SessionDeps.announcePurpose` instead of a summary. */
  purpose?: SessionPurpose;
  /** Only reads are allowed (see AgentRunOptions.readOnly). Persists across resumes. */
  readOnly?: boolean;
}

export type SessionPurpose = 'briefing';

const LEVEL_ORDER: Record<PermissionLevel, number> = { safe: 0, trusted: 1, 'full-auto': 2 };
export const capLevel = (level: PermissionLevel, cap?: PermissionLevel): PermissionLevel =>
  cap && LEVEL_ORDER[cap] < LEVEL_ORDER[level] ? cap : level;

export type StartResult =
  | { ok: true; session: Session }
  | { ok: false; reason: 'limit' | 'agent-missing' | 'folder-missing'; detail?: string };

interface Runtime {
  abort: AbortController;
  queue: string[];
  pid?: number;
  lastSpokenAt?: number;
  narration?: string;
  log?: WriteStream;
  lastHtml?: string;
  project: Project | null;
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly runtime = new Map<string, Runtime>();
  private readonly caps = new Map<string, PermissionLevel>();
  private readonly purposes = new Map<string, SessionPurpose>();
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private lastGlobalProgress = 0;
  private readonly now: () => number;

  constructor(private readonly deps: SessionDeps) {
    this.now = deps.now ?? Date.now;
    for (const s of deps.store.listSessions(200)) this.sessions.set(s.id, s);
  }

  startNarrator(intervalMs = 5_000): void {
    if (this.progressTimer) return;
    this.progressTimer = setInterval(() => void this.tickProgress(), intervalMs);
    this.progressTimer.unref?.();
  }

  stopNarrator(): void {
    if (this.progressTimer) clearInterval(this.progressTimer);
    this.progressTimer = null;
  }

  list(): Session[] {
    return [...this.sessions.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  views(): SessionView[] {
    return this.list()
      .filter((s) => !s.dismissed)
      .map(toSessionView);
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  liveCount(): number {
    return [...this.sessions.values()].filter((s) => isLive(s.status)).length;
  }

  queuedFollowups(id: string): string[] {
    return [...(this.runtime.get(id)?.queue ?? [])];
  }

  /** Marks interrupted sessions from a previous run (called after orphan reaping). */
  markInterrupted(ids: string[], note: string): void {
    for (const id of ids) {
      const s = this.sessions.get(id);
      if (!s || !isLive(s.status)) continue;
      s.status = 'failed';
      s.finishedAt = this.now();
      s.resultText = note;
      this.deps.store.saveSession(s);
      this.deps.store.setSessionProcess(id, null, null);
    }
    // Any other session that was live without a process record is stale too.
    for (const s of this.sessions.values()) {
      if (isLive(s.status) && !this.runtime.has(s.id)) {
        s.status = 'failed';
        s.finishedAt = this.now();
        s.resultText = s.resultText ?? note;
        this.deps.store.saveSession(s);
      }
    }
    this.emit();
  }

  start(req: StartRequest): StartResult {
    const settings = this.deps.settings();
    if (this.liveCount() >= settings.maxConcurrentSessions) return { ok: false, reason: 'limit' };
    const driver = this.deps.drivers[req.agent];
    if (!driver) return { ok: false, reason: 'agent-missing', detail: req.agent };
    const cwd = req.project?.path ?? this.deps.generalWorkspace();
    const session: Session = {
      id: newId('s_'),
      agent: req.agent,
      projectId: req.project?.id ?? null,
      project: req.project?.name ?? 'General',
      cwd,
      task: req.task,
      status: 'running',
      startedAt: this.now(),
      coding: req.coding,
      dismissed: false,
      activity: 'Starting',
    };
    this.sessions.set(session.id, session);
    if (req.purpose) this.purposes.set(session.id, req.purpose);
    if (req.readOnly) this.deps.store.kvSet(`session-readonly:${session.id}`, '1');
    if (req.permissionCap) {
      this.caps.set(session.id, req.permissionCap);
      this.deps.store.kvSet(`session-cap:${session.id}`, req.permissionCap); // survives restarts/resume
    }
    this.deps.store.saveSession(session);
    this.emit();
    void this.run(session, driver, req.task, undefined, req.project);
    return { ok: true, session };
  }

  /**
   * Follow-up for a session: queued while it is live (delivered when the current run finishes),
   * otherwise resumes it with the agent-side session id.
   */
  followup(id: string, text: string): 'queued' | 'resumed' | 'unknown' | 'not-resumable' | 'limit' {
    const s = this.sessions.get(id);
    if (!s) return 'unknown';
    if (isLive(s.status)) {
      const rt = this.runtime.get(id);
      if (!rt) return 'not-resumable';
      rt.queue.push(text);
      return 'queued';
    }
    if (!s.agentSessionId) return 'not-resumable';
    this.purposes.delete(id); // a follow-up is an ordinary conversation
    if (this.liveCount() >= this.deps.settings().maxConcurrentSessions) return 'limit';
    const driver = this.deps.drivers[s.agent];
    if (!driver) return 'not-resumable';
    s.status = 'running';
    s.activity = 'Continuing';
    s.task = `${s.task}\n+ ${text}`.slice(-4000);
    delete s.finishedAt;
    s.dismissed = false;
    this.deps.store.saveSession(s);
    this.emit();
    void this.run(s, driver, text, s.agentSessionId, this.projectFor(s));
    return 'resumed';
  }

  /** Stops a session: aborts the run, denies its pending approvals, clears queued follow-ups (R8), kills the tree (R7). */
  stop(id: string): boolean {
    const s = this.sessions.get(id);
    if (!s || !isLive(s.status)) return false;
    const rt = this.runtime.get(id);
    this.deps.approvals.cancelSession(id);
    if (rt) {
      rt.queue.length = 0;
      rt.abort.abort();
      if (rt.pid) void this.deps.inspector.killTree(rt.pid).catch(() => undefined);
    }
    s.status = 'cancelled';
    s.finishedAt = this.now();
    s.activity = undefined;
    this.deps.store.saveSession(s);
    this.emit();
    return true;
  }

  stopAll(): number {
    let n = 0;
    for (const s of this.list()) if (isLive(s.status) && this.stop(s.id)) n++;
    return n;
  }

  /**
   * Session waiting on the user (an agent called jarvis_ask_user): `needs-input` while waiting, back to
   * `running` after the answer or the timeout. Still counted as live. Only a running session enters the
   * state, and only a `needs-input` session leaves it (a stop or an approval in between wins).
   */
  setNeedsInput(id: string, on: boolean): void {
    const s = this.sessions.get(id);
    if (!s) return;
    if (on ? s.status !== 'running' : s.status !== 'needs-input') return;
    s.status = on ? 'needs-input' : 'running';
    s.activity = on ? 'Waiting for your answer' : s.activity === 'Waiting for your answer' ? undefined : s.activity;
    this.deps.store.saveSession(s);
    this.emit();
  }

  dismiss(id: string): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    if (isLive(s.status)) this.stop(id);
    s.dismissed = true;
    this.deps.store.saveSession(s);
    this.emit();
    return true;
  }

  clearFinished(): number {
    const ids = this.list()
      .filter((s) => !isLive(s.status))
      .map((s) => s.id);
    for (const id of ids) this.sessions.delete(id);
    this.deps.store.deleteSessions(ids);
    this.emit();
    return ids.length;
  }

  logPath(id: string): string {
    return join(this.deps.dataDir, 'logs', 'sessions', `${id}.ndjson`);
  }

  emit(): void {
    this.deps.ui.emit('ui.sessions', { sessions: this.views() });
  }

  /** Effective permission level of a session: its project's level, capped when started by another agent. */
  permissionOf(id: string, project: Project | null): PermissionLevel {
    const cap =
      this.caps.get(id) ?? (this.deps.store.kvGet(`session-cap:${id}`) as PermissionLevel | null) ?? undefined;
    return capLevel(project?.permission ?? 'safe', cap);
  }

  private projectFor(s: Session): Project | null {
    if (!s.projectId) return null;
    return this.deps.store.listProjects().find((p) => p.id === s.projectId) ?? null;
  }

  private openLog(id: string): WriteStream | undefined {
    try {
      mkdirSync(join(this.deps.dataDir, 'logs', 'sessions'), { recursive: true });
      const ws = createWriteStream(this.logPath(id), { flags: 'a', mode: 0o600 });
      ws.on('error', () => undefined);
      return ws;
    } catch {
      return undefined;
    }
  }

  private async run(
    s: Session,
    driver: AgentDriver,
    task: string,
    resumeId: string | undefined,
    project: Project | null,
  ): Promise<void> {
    const settings = this.deps.settings();
    const abort = new AbortController();
    const prev = this.runtime.get(s.id);
    const rt: Runtime = { abort, queue: prev?.queue ?? [], project, log: prev?.log ?? this.openLog(s.id) };
    this.runtime.set(s.id, rt);
    const write = (ev: unknown) => rt.log?.write(`${JSON.stringify({ t: this.now(), ...(ev as object) })}\n`);
    write({ type: 'start', task, resumeId: resumeId ?? null, agent: s.agent });

    let result: { text: string; isError: boolean; url?: string } | null = null;
    let lastText = '';
    const opts: HostRunOptions = {
      task,
      cwd: s.cwd,
      guidance: this.deps.guidance(),
      permission: this.permissionOf(s.id, project),
      allowlist: project?.allowlist ?? [],
      signal: abort.signal,
      sessionId: s.id,
      coding: s.coding,
      readOnly: this.deps.store.kvGet(`session-readonly:${s.id}`) === '1',
      locale: settings.locale,
      ...(this.deps.tokens ? { mcpSessionToken: this.deps.tokens.issue(s.id) } : {}),
      onProcess: (pid, startTime) => {
        rt.pid = pid;
        this.deps.inspector.adopt?.(pid);
        this.deps.store.setSessionProcess(s.id, pid, startTime);
      },
      requestApproval: async (req) => {
        this.setStatus(s, 'approval');
        try {
          const input = {
            sessionId: s.id,
            agent: s.agent,
            projectId: s.projectId,
            project: s.project,
            kind: req.kind,
            risk: req.risk,
            title: req.title,
            detail: req.detail,
            ...(req.cwd ? { cwd: req.cwd } : {}),
            ...(req.reason ? { reason: req.reason } : {}),
          };
          return await this.deps.approvals.request(input);
        } finally {
          if (s.status === 'approval') this.setStatus(s, 'running');
        }
      },
    };
    if (resumeId) opts.resumeId = resumeId;
    if (s.coding && s.agent === 'claude') opts.model = settings.codingModel;

    try {
      for await (const ev of driver.run(opts)) {
        write(ev);
        this.onEvent(s, rt, ev);
        if (ev.type === 'text') lastText = ev.text;
        if (ev.type === 'result') result = ev.url ? { text: ev.text, isError: ev.isError, url: ev.url } : ev;
        if (abort.signal.aborted) break;
      }
    } catch (e) {
      result = { text: `Agent error: ${errorMessage(e)}`, isError: true };
      this.deps.logger.error('agent run failed', { session: s.id, error: e });
    }
    write({ type: 'end' });
    this.deps.store.setSessionProcess(s.id, null, null);
    if (rt.pid && !abort.signal.aborted) this.deps.inspector.release?.(rt.pid);
    rt.pid = undefined;

    if (abort.signal.aborted || s.status === 'cancelled') {
      rt.queue.length = 0;
      this.finishRuntime(s.id);
      return;
    }
    const text = (result?.text || lastText || '').slice(0, RESULT_MAX);
    s.status = result?.isError ? 'failed' : 'done';
    s.finishedAt = this.now();
    s.activity = undefined;
    s.resultText = text;
    const viewable = detectViewable(text, result?.url, s.cwd);
    if (viewable) s.resultUrl = viewable;
    this.deps.store.saveSession(s);
    this.emit();

    // Queued follow-ups continue the same agent conversation before announcing.
    const next = rt.queue.shift();
    if (next !== undefined && s.status === 'done' && s.agentSessionId) {
      s.status = 'running';
      s.activity = 'Continuing';
      delete s.finishedAt;
      this.deps.store.saveSession(s);
      this.emit();
      void this.run(s, driver, next, s.agentSessionId, project);
      return;
    }
    rt.queue.length = 0;
    this.finishRuntime(s.id);
    await this.announce(s);
  }

  private finishRuntime(id: string): void {
    this.deps.tokens?.revoke(id);
    const rt = this.runtime.get(id);
    rt?.log?.end();
    this.runtime.delete(id);
  }

  private setStatus(s: Session, status: Session['status']): void {
    if (!isLive(s.status)) return;
    s.status = status;
    this.deps.store.saveSession(s);
    this.emit();
  }

  private onEvent(s: Session, rt: Runtime, ev: AgentEvent): void {
    switch (ev.type) {
      case 'session-id':
        s.agentSessionId = ev.id;
        this.deps.store.saveSession(s);
        break;
      case 'activity':
        s.activity = ev.text.slice(0, 120);
        this.deps.store.queueSessionActivity(s.id, s.activity);
        this.emit();
        break;
      case 'narration':
        rt.narration = ev.text.slice(0, 160);
        break;
      default:
        break;
    }
  }

  private async announce(s: Session): Promise<void> {
    const settings = this.deps.settings();
    const p = phrases(settings.locale);
    const purpose = this.purposes.get(s.id);
    if (purpose && this.deps.announcePurpose && s.status === 'done') {
      this.purposes.delete(s.id);
      let custom: string | null = null;
      try {
        custom = await this.deps.announcePurpose(s, purpose);
      } catch (e) {
        this.deps.logger.warn('purpose announcement failed', { error: errorMessage(e) });
      }
      if (custom) {
        await this.deps.speak(custom); // the user asked for it: spoken like a reply, not a background summary
        return;
      }
    }
    const openable = safeOpenable(s.resultUrl, s.cwd);
    if (openable && settings.openResults && this.deps.host.connected) {
      await this.deps.host.call('host.open', openable).catch(() => undefined);
    }
    let line = s.status === 'done' ? p.sessionDone(s.project) : p.sessionFailed(s.project);
    try {
      line = (await this.deps.summarize(s)) || line;
    } catch (e) {
      this.deps.logger.warn('summary failed, using phrase', { error: errorMessage(e) });
    }
    if (this.deps.host.connected) {
      void this.deps.host
        .call('host.notify', { title: `Jarvis · ${s.project}`, body: line.replace(/\[[a-z -]+\]\s*/gi, '') })
        .catch(() => undefined);
    }
    if (settings.speakSummaries) await this.deps.speak(line);
  }

  /** Progress narration: first after 20 s, then ≤ every 45 s per session, one session at a time. */
  async tickProgress(): Promise<boolean> {
    const settings = this.deps.settings();
    if (!settings.speakProgress || this.deps.isQuiet()) return false;
    const now = this.now();
    if (now - this.lastGlobalProgress < PROGRESS_GLOBAL_GAP_MS) return false;
    const due = this.list()
      .filter((s) => s.status === 'running' && now - s.startedAt >= PROGRESS_FIRST_MS)
      .map((s) => ({ s, rt: this.runtime.get(s.id) }))
      .filter(({ rt }) => rt && (rt.lastSpokenAt === undefined || now - rt.lastSpokenAt >= PROGRESS_EVERY_MS))
      .sort((a, b) => (a.rt?.lastSpokenAt ?? 0) - (b.rt?.lastSpokenAt ?? 0));
    const pick = due[0];
    if (!pick?.rt) return false;
    const doing = (pick.rt.narration ?? pick.s.activity ?? '').replace(/[.!]+$/, '');
    if (!doing) return false;
    pick.rt.lastSpokenAt = now;
    this.lastGlobalProgress = now;
    const elapsed = spokenDuration((now - pick.s.startedAt) / 1000, settings.locale);
    const doingLc = doing.charAt(0).toLowerCase() + doing.slice(1);
    await this.deps.speak(phrases(settings.locale).progress(elapsed, doingLc));
    return true;
  }
}
