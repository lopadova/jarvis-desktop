/**
 * Composition root of the sidecar: wires store, voice, approvals, sessions, orchestrator, reminders,
 * MCP handler and relay, and registers every RPC method (app.*, voice.*, mcp.call) with role gating.
 * Transport-agnostic: tests drive it with a fake host/UI; production uses RpcServer for both.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AgentDriver,
  type AgentId,
  AppMethods,
  isLive,
  type Logger,
  McpCallSchema,
  mergeSettings,
  type Project,
  type ProviderStatus,
  phrases,
  type Role,
  RpcErrorCode,
  type SecretStore,
  type Session,
  type Settings,
  type SuggestionRequirement,
  suggestionsFor,
  summarySystemPrompt,
  toSessionView,
  VoiceNotifications,
  wrapUntrusted,
} from '@jarvis/core';
import type { z } from 'zod';
import type { McpCommand } from './agents/claude.js';
import { ClaudeDriver } from './agents/claude.js';
import { CodexDriver } from './agents/codex.js';
import { HomeDriver } from './agents/home.js';
import { McpClientPool } from './agents/mcp-clients.js';
import { ApprovalBroker } from './approvals.js';
import type { CallContext, HostClient, UiSink } from './host.js';
import { type McpCallInput, McpHandler } from './mcp-handler.js';
import { McpSessionTokens } from './mcp-tokens.js';
import { MemoryService } from './memory-service.js';
import { Orchestrator } from './orchestrator.js';
import { extraPhrases } from './phrases-extra.js';
import { Pill } from './pill.js';
import { type ProcessInspector, reapOrphans } from './process/proc.js';
import {
  type BrainRegistry,
  type ChatGptPlanAuthLike,
  LOCAL_STT,
  type SttRegistry,
  type TtsRegistry,
} from './providers-contract.js';
import { RelayClient, type RelayDeps } from './relay.js';
import { ReminderScheduler } from './reminders.js';
import { RpcError } from './rpc/server.js';
import { SessionManager } from './sessions.js';
import type { Store } from './store/store.js';
import { errorMessage, expandHome, newId } from './util.js';
import { safeOpenable } from './viewable.js';
import { VoiceOutput } from './voice/output.js';

export const VERSION = '0.1.0';

export interface AppDeps {
  store: Store;
  host: HostClient;
  ui: UiSink;
  logger: Logger;
  secrets: SecretStore;
  dataDir: string;
  brains: BrainRegistry;
  tts: TtsRegistry;
  stt: SttRegistry;
  chatgptAuth?: ChatGptPlanAuthLike;
  drivers?: Partial<Record<AgentId, AgentDriver>>;
  inspector: ProcessInspector;
  /** Jarvis MCP bridge command attached to Claude sessions (evaluated per run: it carries the RPC port). */
  mcpCommand?: () => McpCommand | null;
  relay?: Partial<Pick<RelayDeps, 'connect' | 'fetch' | 'pingMs' | 'backoff'>>;
  approvalTimeoutMs?: number;
  now?: () => number;
  timeZone?: string;
}

export interface RpcRegistrar {
  register(
    method: string,
    spec: { schema: z.ZodType; roles: readonly Role[]; handler: (params: never, ctx: CallContext) => unknown },
  ): void;
}

const ok = { ok: true } as const;
const SHELL_SETTINGS = new Set(['wakeWord', 'privateMode']);

export class App {
  readonly pill: Pill;
  readonly voice: VoiceOutput;
  readonly approvals: ApprovalBroker;
  readonly sessions: SessionManager;
  readonly orchestrator: Orchestrator;
  readonly reminders: ReminderScheduler;
  readonly memory: MemoryService;
  readonly mcp: McpHandler;
  readonly relay: RelayClient;
  readonly drivers: Partial<Record<AgentId, AgentDriver>>;
  /** Per-session MCP tokens; the RPC server resolves them to verified caller identities. */
  readonly tokens = new McpSessionTokens();
  private userTalking = false;
  private bargeIn = false;
  private agentCache: { at: number; list: AgentId[] } | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: AppDeps) {
    this.now = deps.now ?? Date.now;
    const settings = () => this.settings();
    this.pill = new Pill(deps.ui, () => this.settings().privateMode);
    this.voice = new VoiceOutput({
      host: deps.host,
      tts: deps.tts,
      settings,
      logger: deps.logger,
      pill: this.pill,
      onNotice: (m) => deps.logger.info('voice notice', { message: m }),
    });
    const speakLine = (text: string) => {
      void this.orchestrator.jarvisSays(text);
    };
    this.approvals = new ApprovalBroker({
      store: deps.store,
      ui: deps.ui,
      pill: this.pill,
      speak: speakLine,
      settings,
      logger: deps.logger,
      timeoutMs: deps.approvalTimeoutMs,
      now: this.now,
    });
    this.memory = new MemoryService(deps.store, this.now);
    this.drivers = deps.drivers ?? this.defaultDrivers();
    this.sessions = new SessionManager({
      store: deps.store,
      drivers: this.drivers,
      approvals: this.approvals,
      host: deps.host,
      ui: deps.ui,
      settings,
      logger: deps.logger,
      dataDir: deps.dataDir,
      inspector: deps.inspector,
      speak: (t) => this.orchestrator.jarvisSays(t),
      isQuiet: () => this.userTalking || this.voice.busy || this.voice.muted,
      summarize: (s) => this.summarize(s),
      guidance: () => this.memory.guidance(),
      generalWorkspace: () => this.generalWorkspace(),
      tokens: this.tokens,
      now: this.now,
    });
    this.reminders = new ReminderScheduler({
      store: deps.store,
      host: deps.host,
      ui: deps.ui,
      settings,
      logger: deps.logger,
      speak: (t) => this.orchestrator.jarvisSays(t),
      now: this.now,
    });
    this.orchestrator = new Orchestrator({
      store: deps.store,
      settings,
      updateSettings: (p) => this.updateSettings(p),
      logger: deps.logger,
      ui: deps.ui,
      host: deps.host,
      pill: this.pill,
      voice: this.voice,
      brains: deps.brains,
      sessions: this.sessions,
      approvals: this.approvals,
      reminders: this.reminders,
      memory: this.memory,
      availableAgents: () => this.availableAgents(),
      onProvidersChanged: () => void this.publishProviders(),
      now: this.now,
      timeZone: deps.timeZone,
    });
    this.mcp = new McpHandler(
      {
        settings,
        logger: deps.logger,
        ui: deps.ui,
        host: deps.host,
        speak: (t) => this.orchestrator.jarvisSays(t),
        ask: (q, o, ms) => this.orchestrator.ask(q, o, ms),
        setNeedsInput: (id, waiting) => this.sessions.setNeedsInput(id, waiting),
        startTask: (req, origin) => this.startTaskFromMcp(req, origin),
        sessions: () => this.sessions.list(),
        remember: (t) => this.memory.add(t),
        recall: () => this.memory.list(),
        confirm: async (title, detail) =>
          (await this.approvals.request({
            sessionId: 'external',
            agent: 'home',
            projectId: null,
            project: 'External app',
            kind: 'mcp-tool',
            risk: 'high', // click only (R2)
            title,
            detail,
          })) !== 'deny',
      },
      this.now,
    );
    this.relay = new RelayClient({
      secrets: deps.secrets,
      settings,
      updateSettings: (p) => {
        this.updateSettings(p);
      },
      ui: deps.ui,
      logger: deps.logger,
      call: (input) => this.mcp.call(input),
      ...deps.relay,
    });
  }

  // ───────── settings ─────────

  settings(): Settings {
    return this.deps.store.getSettings();
  }

  updateSettings(patch: Record<string, unknown>): Settings {
    const before = this.settings();
    const next = this.deps.store.saveSettings(mergeSettings(before, patch));
    this.deps.ui.emit('ui.settings', { settings: next });
    if (before.privateMode !== next.privateMode) this.pill.publish();
    if (before.relayExposeWriteTools !== next.relayExposeWriteTools) this.relay.refreshHello();
    this.agentCache = null;
    return next;
  }

  generalWorkspace(): string {
    const s = this.settings();
    const dir = s.generalWorkspace ? expandHome(s.generalWorkspace) : join(this.deps.dataDir, 'workspace');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  // ───────── lifecycle ─────────

  async start(): Promise<void> {
    const s = this.settings();
    if (s.historyRetentionDays > 0) this.deps.store.pruneHistory(this.now() - s.historyRetentionDays * 86_400_000);
    await this.reapOrphans();
    this.reminders.start();
    this.sessions.startNarrator();
    void this.relay.start().catch((e) => this.deps.logger.warn('relay start failed', { error: errorMessage(e) }));
  }

  async reapOrphans(): Promise<void> {
    const records = this.deps.store.sessionsWithProcess();
    const res = await reapOrphans(records, this.deps.inspector, this.deps.logger);
    for (const r of records) this.deps.store.setSessionProcess(r.id, null, null);
    this.sessions.markInterrupted(
      records.map((r) => r.id),
      extraPhrases(this.settings().locale).interrupted,
    );
    if (records.length) this.deps.logger.info('orphan reaping done', { ...res });
  }

  stop(): void {
    this.sessions.stopNarrator();
    this.sessions.stopAll();
    this.reminders.stop();
    this.relay.stop();
    this.voice.stop();
  }

  // ───────── agents & brains ─────────

  private defaultDrivers(): Partial<Record<AgentId, AgentDriver>> {
    const settings = () => this.settings();
    const mcpCommand = () => this.deps.mcpCommand?.() ?? null;
    return {
      claude: new ClaudeDriver({ settings, logger: this.deps.logger, mcpCommand }),
      codex: new CodexDriver({
        settings,
        logger: this.deps.logger,
        mcpCommand,
        killTree: (pid) => this.deps.inspector.killTree(pid),
      }),
      home: new HomeDriver({
        brain: () => {
          const pick = this.orchestrator.pickBrain();
          return pick.ok ? pick.brain : undefined;
        },
        host: this.deps.host,
        settings,
        logger: this.deps.logger,
        mcp: new McpClientPool(this.deps.dataDir, this.deps.logger),
        projectRoots: () => this.deps.store.listProjects().map((p) => p.path),
      }),
    };
  }

  async availableAgents(): Promise<AgentId[]> {
    if (this.agentCache && this.now() - this.agentCache.at < 30_000) return this.agentCache.list;
    const list: AgentId[] = [];
    for (const [id, d] of Object.entries(this.drivers) as [AgentId, AgentDriver][]) {
      try {
        if ((await d.available()).ok) list.push(id);
      } catch {
        /* unavailable */
      }
    }
    this.agentCache = { at: this.now(), list };
    return list;
  }

  async providerStatuses(): Promise<ProviderStatus[]> {
    const primary = this.settings().primaryBrain;
    try {
      return (await this.deps.brains.statuses()).map((s) => ({ ...s, primary: s.id === primary }));
    } catch (e) {
      this.deps.logger.warn('provider statuses failed', { error: errorMessage(e) });
      return [];
    }
  }

  async publishProviders(): Promise<ProviderStatus[]> {
    const providers = await this.providerStatuses();
    this.deps.ui.emit('ui.providers', { providers });
    return providers;
  }

  /** One spoken sentence for a finished session; content is wrapped as untrusted data (R4). */
  async summarize(s: Session): Promise<string> {
    const pick = this.orchestrator.pickBrain();
    const st = this.settings();
    const p = phrases(st.locale);
    const fallback = s.status === 'done' ? p.sessionDone(s.project) : p.sessionFailed(s.project);
    if (!pick.ok) return fallback;
    const res = await pick.brain.complete({
      messages: [
        { role: 'system', content: summarySystemPrompt(st.locale) },
        {
          role: 'user',
          content: `Task: "${s.task.slice(0, 300)}"\nProject: ${s.project}\nStatus: ${s.status}${
            s.resultUrl && st.openResults ? '\nThe result was opened on screen.' : ''
          }\n${wrapUntrusted(`result of ${s.id}`, s.resultText ?? '', 3000)}`,
        },
      ],
      jsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { speak: { type: 'string' } },
        required: ['speak'],
      },
      tier: 'fast',
    });
    let speak: unknown = (res.json as { speak?: unknown } | undefined)?.speak;
    if (typeof speak !== 'string') {
      try {
        speak = (
          JSON.parse(res.text.slice(res.text.indexOf('{'), res.text.lastIndexOf('}') + 1)) as { speak?: unknown }
        ).speak;
      } catch {
        speak = undefined;
      }
    }
    return typeof speak === 'string' && speak.trim() ? speak.trim().slice(0, 300) : fallback;
  }

  /** `jarvis_start_task`: same policy as voice; tasks from an agent never exceed the caller's level. */
  async startTaskFromMcp(
    req: { task: string; project?: string; agent?: AgentId },
    origin: { via: string; client?: string; callerSessionId?: string },
  ): Promise<{ ok: boolean; message: string; sessionId?: string }> {
    const s = this.settings();
    const p = phrases(s.locale);
    const projects = this.deps.store.listProjects();
    const n = req.project?.trim().toLowerCase();
    const project = n
      ? (projects.find((x) => x.name.toLowerCase() === n || x.aliases.some((a) => a.toLowerCase() === n)) ?? null)
      : null;
    if (n && !project) return { ok: false, message: `Unknown project "${req.project}".` };
    // Fail closed: unverified callers (no per-session token) always run at `safe`.
    let permissionCap: Project['permission'] = 'safe';
    if (origin.callerSessionId) {
      const caller = this.sessions.get(origin.callerSessionId);
      if (!caller) return { ok: false, message: 'Unknown calling session.' };
      const callerProject = projects.find((x) => x.id === caller.projectId) ?? null;
      permissionCap =
        project && project.id === caller.projectId ? this.sessions.permissionOf(caller.id, callerProject) : 'safe';
    }
    const available = await this.availableAgents();
    const agent: AgentId = req.agent ?? project?.defaultAgent ?? s.defaultAgent;
    if (!available.includes(agent)) return { ok: false, message: p.agentMissing(agent) };
    const startReq = {
      agent,
      project,
      task: req.task,
      coding: agent !== 'home',
      origin: `mcp:${origin.via}${origin.client ? `:${origin.client}` : ''}`,
      permissionCap,
    };
    const r = this.sessions.start(startReq);
    if (!r.ok) {
      return {
        ok: false,
        message: r.reason === 'limit' ? p.tooManySessions(s.maxConcurrentSessions) : p.agentMissing(agent),
      };
    }
    this.orchestrator.chat({
      id: newId('c_'),
      role: 'system',
      card: { type: 'session-started', session: toSessionView(r.session) },
      at: this.now(),
    });
    return { ok: true, message: p.started(r.session.project), sessionId: r.session.id };
  }

  // ───────── voice input ─────────

  private async cloudStt(pcmBase64: string): Promise<void> {
    const s = this.settings();
    const x = extraPhrases(s.locale);
    if (LOCAL_STT.includes(s.stt)) return;
    if (s.privateMode) {
      this.deps.ui.emit('ui.toast', { level: 'warning', title: x.cloudSttPrivate });
      return;
    }
    const provider = this.deps.stt.get(s.stt);
    if (!provider) return;
    try {
      const { text } = await provider.transcribe({ pcm: Buffer.from(pcmBase64, 'base64'), locale: s.locale });
      this.userTalking = false;
      if (text.trim()) await this.orchestrator.submit(text, 'voice');
    } catch (e) {
      this.deps.logger.warn('cloud stt failed', { error: errorMessage(e) });
      await this.orchestrator.jarvisSays(x.sttFailed);
    }
  }

  // ───────── state snapshot ─────────

  state(): Record<string, unknown> {
    return {
      version: VERSION,
      settings: this.settings(),
      sessions: this.sessions.views(),
      pending: this.approvals.list(),
      providers: [],
      reminders: this.reminders.list(),
      chat: this.deps.store.recentChat(100),
      pill: { state: this.pill.state, privateMode: this.settings().privateMode },
      relay: this.relay.status(),
    };
  }

  // ───────── RPC registration ─────────

  register(server: RpcRegistrar): void {
    const ui: readonly Role[] = ['ui'];
    const uiShell: readonly Role[] = ['ui', 'shell'];
    const A = AppMethods;
    type P<M extends keyof typeof AppMethods> = z.output<(typeof AppMethods)[M]>;
    const reg = <M extends keyof typeof AppMethods>(
      m: M,
      roles: readonly Role[],
      handler: (p: P<M>, ctx: CallContext) => unknown,
    ) => server.register(m, { schema: A[m], roles, handler: handler as (p: never, c: CallContext) => unknown });

    reg('app.hello', ['ui', 'shell', 'mcp'], (_p, ctx) => ({
      role: ctx.role,
      version: VERSION,
      privateMode: this.settings().privateMode,
    }));
    reg('app.state', uiShell, async () => ({ ...this.state(), providers: await this.providerStatuses() }));
    reg('turn.submit', ui, (p) => {
      void this.orchestrator.submit(p.text, p.source);
      return ok;
    });
    reg('voice.stopSpeaking', uiShell, () => {
      this.orchestrator.stop();
      return ok;
    });
    reg('session.stop', ui, (p) => ({ ok: this.sessions.stop(p.id) }));
    reg('session.reply', ui, (p) => ({ result: this.sessions.followup(p.id, p.text) }));
    reg('session.dismiss', ui, (p) => ({ ok: this.sessions.dismiss(p.id) }));
    reg('session.clearFinished', ui, () => ({ removed: this.sessions.clearFinished() }));
    reg('session.open', ui, async (p) => {
      const s = this.sessions.get(p.id);
      if (!s) throw new RpcError(RpcErrorCode.invalidParams, 'unknown session');
      // Only a safe result (localhost URL / file inside the session folder); otherwise the folder itself.
      await this.deps.host.call('host.open', safeOpenable(s.resultUrl, s.cwd) ?? { target: s.cwd, kind: 'path' });
      return ok;
    });
    reg('session.showLog', ui, async (p) => {
      if (!this.sessions.get(p.id)) throw new RpcError(RpcErrorCode.invalidParams, 'unknown session');
      await this.deps.host.call('host.open', { target: this.sessions.logPath(p.id), kind: 'path' });
      return ok;
    });
    reg('approval.decide', ui, (p) => this.approvals.decide(p.id, p.decision, p.via));
    reg('settings.get', uiShell, () => ({ settings: this.settings() }));
    reg('settings.update', uiShell, (p, ctx) => {
      // The shell (tray toggles) may only flip hands-free and private mode.
      if (ctx.role === 'shell' && Object.keys(p.patch).some((k) => !SHELL_SETTINGS.has(k))) {
        throw new RpcError(RpcErrorCode.unauthorized, 'the shell may only update wakeWord and privateMode');
      }
      try {
        return { settings: this.updateSettings(p.patch) };
      } catch (e) {
        throw new RpcError(RpcErrorCode.invalidParams, `invalid settings: ${errorMessage(e)}`);
      }
    });
    reg('projects.list', ui, () => ({ projects: this.deps.store.listProjects() }));
    reg('projects.upsert', ui, (p) => {
      const project: Project = { ...p.project, id: p.project.id ?? newId('p_'), path: expandHome(p.project.path) };
      this.deps.store.upsertProject(project);
      return { project };
    });
    reg('projects.remove', ui, (p) => {
      this.deps.store.removeProject(p.id);
      return ok;
    });
    reg('memory.list', ui, () => ({ memories: this.memory.list() }));
    reg('memory.remove', ui, (p) => ({ ok: !!this.memory.forget(p.id) }));
    reg('memory.clear', ui, () => {
      this.memory.clear();
      return ok;
    });
    reg('history.list', ui, (p) => ({ turns: this.deps.store.listTurns(p.query, p.limit) }));
    reg('history.clear', ui, (p) => {
      const d = new Date(this.now());
      d.setHours(0, 0, 0, 0);
      this.deps.store.clearHistory(p.scope === 'today' ? d.getTime() : 0);
      return ok;
    });
    reg('providers.status', ui, async () => ({ providers: await this.publishProviders() }));
    reg('providers.signIn', ui, async () => {
      if (!this.deps.chatgptAuth) throw new RpcError(RpcErrorCode.notAvailable, 'ChatGPT sign-in is not available');
      const r = await this.deps.chatgptAuth.signIn();
      void this.publishProviders();
      return { account: r.account, plan: r.plan ?? null };
    });
    reg('providers.signOut', ui, async () => {
      await this.deps.chatgptAuth?.signOut();
      void this.publishProviders();
      return ok;
    });
    reg('providers.setPrimary', ui, async (p) => {
      this.updateSettings({ primaryBrain: p.brain });
      return { providers: await this.publishProviders() };
    });
    reg('secrets.set', ui, async (p) => {
      await this.deps.secrets.set(p.key, p.value);
      void this.publishProviders();
      return ok;
    });
    reg('secrets.delete', ui, async (p) => {
      await this.deps.secrets.delete(p.key);
      void this.publishProviders();
      return ok;
    });
    reg('tts.voices', ui, async (p) => {
      if (p.provider === 'system') return { voices: [] };
      const prov = this.deps.tts.get(p.provider);
      return { voices: (await prov?.voices?.(p.query, this.settings().locale)) ?? [] };
    });
    reg('tts.preview', ui, (p) => {
      const sample =
        this.settings().locale === 'it' ? '[happy] Ciao! Questa è la mia voce.' : "[happy] Hi! This is how I'll sound.";
      void this.voice.speak(sample, p.voiceId ? { tts: p.provider, voiceId: p.voiceId } : { tts: p.provider });
      return ok;
    });
    reg('suggestions.list', ui, async () => {
      const agents = await this.availableAgents();
      const caps = new Set<SuggestionRequirement>();
      if (agents.length) caps.add('agent');
      if (agents.includes('claude') || agents.includes('codex')) caps.add('developer');
      if (this.deps.host.connected) {
        caps.add('clipboard');
        caps.add('screen');
      }
      return {
        suggestions: suggestionsFor({
          locale: this.settings().locale,
          hour: new Date(this.now()).getHours(),
          capabilities: caps,
        }),
      };
    });
    reg('relay.status', ui, () => this.relay.status());
    reg('relay.pair', ui, async (p) => {
      try {
        return await this.relay.pair(p.relayUrl);
      } catch (e) {
        throw new RpcError(RpcErrorCode.notAvailable, errorMessage(e));
      }
    });
    reg('relay.unpair', ui, async () => ({ ok: true, ...(await this.relay.unpair()) }));
    reg('reminders.list', ui, () => ({ reminders: this.reminders.list() }));
    reg('reminders.cancel', ui, (p) => ({ ok: this.reminders.cancel(p.id) }));

    // voice.* notifications from the shell
    const shell: readonly Role[] = ['shell'];
    const V = VoiceNotifications;
    type VP<M extends keyof typeof VoiceNotifications> = z.output<(typeof VoiceNotifications)[M]>;
    const vreg = <M extends keyof typeof VoiceNotifications>(m: M, handler: (p: VP<M>) => unknown) =>
      server.register(m, { schema: V[m], roles: shell, handler: handler as (p: never) => unknown });

    vreg('voice.wake', (p) => {
      this.userTalking = true;
      if (p.trigger === 'barge-in' && this.voice.busy) {
        this.bargeIn = true;
        this.voice.pause(true);
      }
      this.pill.set({ kind: 'listening', level: 0, partial: '', committed: '' });
      return ok;
    });
    vreg('voice.partial', (p) => {
      this.pill.set({ kind: 'listening', level: p.level, partial: p.partial, committed: p.committed });
      return ok;
    });
    vreg('voice.transcript', (p) => {
      this.userTalking = false;
      if (this.bargeIn) {
        this.bargeIn = false;
        this.voice.stop();
      }
      if (!p.text.trim()) {
        this.pill.set({ kind: 'hidden' });
        return ok;
      }
      void this.orchestrator.submit(p.text, 'voice');
      return ok;
    });
    vreg('voice.nothingHeard', () => {
      this.userTalking = false;
      if (this.bargeIn) {
        this.bargeIn = false;
        this.voice.pause(false);
      }
      this.pill.set({ kind: 'hidden' });
      return ok;
    });
    vreg('voice.audio', (p) => {
      void this.cloudStt(p.pcmBase64);
      return ok;
    });
    vreg('voice.playbackLevel', (p) => {
      this.voice.onPlaybackLevel(p.level);
      return ok;
    });
    vreg('voice.playbackEnded', (p) => {
      this.voice.onPlaybackEnded(p.utteranceId);
      return ok;
    });
    vreg('host.focusChanged', (p) => {
      this.voice.setDoNotDisturb(p.doNotDisturb);
      return ok;
    });

    // mcp.call — the only method the mcp role can reach besides app.hello
    server.register('mcp.call', {
      schema: McpCallSchema,
      roles: ['mcp'],
      handler: ((p: z.output<typeof McpCallSchema>, ctx: CallContext) => {
        // Caller identity comes ONLY from the token the connection authenticated with (ctx), never from `client`.
        const input: McpCallInput = { tool: p.tool, args: p.args, origin: p.origin };
        if (p.client) input.client = p.client;
        if (ctx.callerSessionId) input.callerSessionId = ctx.callerSessionId;
        return this.mcp.call(input);
      }) as (p: never, ctx: CallContext) => unknown,
    });
  }

  /** Live session count (diagnostics). */
  liveSessions(): number {
    return this.sessions.list().filter((s) => isLive(s.status)).length;
  }
}
