import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentDriver,
  AgentEvent,
  AgentId,
  AgentRunOptions,
  BrainId,
  BrainProvider,
  BrainRequest,
  BrainResponse,
  HostMethod,
  HostMethods,
  ProviderStatus,
  Settings,
  TtsAudio,
  TtsId,
  TtsProvider,
  TtsRequest,
  UiEvent,
} from '@jarvis/core';
import { App, type AppDeps } from '../src/app.js';
import type { HostClient, UiSink } from '../src/host.js';
import { MemoryLogger } from '../src/log/logger.js';
import type { ProcessInspector } from '../src/process/proc.js';
import type { BrainRegistry, TtsRegistry } from '../src/providers-contract.js';
import { emptySttRegistry } from '../src/providers-contract.js';
import { MemorySecretStore } from '../src/secrets.js';
import { openDatabase } from '../src/store/sqlite.js';
import { Store } from '../src/store/store.js';

export const tmp = (prefix = 'jarvis-test-'): string => mkdtempSync(join(tmpdir(), prefix));

export const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function until(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await tick(5);
  }
}

export class FakeUi implements UiSink {
  readonly events: { event: UiEvent; payload: unknown }[] = [];
  emit(event: UiEvent, payload: unknown): void {
    this.events.push({ event, payload });
  }
  of<T = unknown>(event: UiEvent): T[] {
    return this.events.filter((e) => e.event === event).map((e) => e.payload as T);
  }
  last<T = unknown>(event: UiEvent): T | undefined {
    return this.of<T>(event).at(-1);
  }
}

/** Fake Rust shell: records calls; reports playback end immediately so speech never blocks. */
export class FakeHost implements HostClient {
  connected = true;
  readonly calls: { method: HostMethod; params: unknown }[] = [];
  readonly frames: { utteranceId: string; bytes: number }[] = [];
  onPlaybackEnded: ((id: string) => void) | null = null;
  responses: Partial<Record<HostMethod, unknown>> = {};
  async call<M extends HostMethod>(method: M, params: HostMethods[M]['params']): Promise<HostMethods[M]['result']> {
    this.calls.push({ method, params });
    if (method === 'host.systemSpeak' || method === 'host.audio.end') {
      const id = (params as { utteranceId: string }).utteranceId;
      queueMicrotask(() => this.onPlaybackEnded?.(id));
    }
    if (method === 'host.clipboard.read') return (this.responses[method] ?? { text: 'clip' }) as never;
    return (this.responses[method] ?? { ok: true }) as never;
  }
  sendAudio(utteranceId: string, chunk: Uint8Array): void {
    this.frames.push({ utteranceId, bytes: chunk.byteLength });
  }
  of(method: HostMethod): unknown[] {
    return this.calls.filter((c) => c.method === method).map((c) => c.params);
  }
  spoken(): string[] {
    return (this.of('host.systemSpeak') as { text: string }[]).map((p) => p.text);
  }
}

type BrainStep = BrainResponse | Error | ((req: BrainRequest) => BrainResponse | Promise<BrainResponse>);

export class FakeBrain implements BrainProvider {
  readonly requests: BrainRequest[] = [];
  readonly steps: BrainStep[] = [];
  fallback: BrainStep = { text: '{"speak":"ok"}' };
  constructor(
    readonly id: BrainId = 'chatgpt',
    readonly label = 'ChatGPT',
  ) {}
  async status(): Promise<ProviderStatus> {
    return { id: this.id, connected: true, state: 'ok', primary: false };
  }
  push(...s: BrainStep[]): this {
    this.steps.push(...s);
    return this;
  }
  async complete(req: BrainRequest): Promise<BrainResponse> {
    this.requests.push(req);
    const step = this.steps.shift() ?? this.fallback;
    if (step instanceof Error) throw step;
    return typeof step === 'function' ? step(req) : step;
  }
}

export const routerJson = (o: Record<string, unknown>): BrainResponse => {
  const full = {
    agent: null,
    project: null,
    sessionId: null,
    task: null,
    coding: null,
    quickReplies: null,
    reminder: null,
    remember: null,
    forget: null,
    ...o,
  };
  return { text: JSON.stringify(full), json: full };
};

export function brainRegistry(...brains: BrainProvider[]): BrainRegistry {
  return {
    get: (id) => brains.find((b) => b.id === id),
    list: () => brains,
    statuses: async () => Promise.all(brains.map((b) => b.status())),
  };
}

export class FakeTts implements TtsProvider {
  readonly requests: TtsRequest[] = [];
  fail = false;
  constructor(
    readonly id: TtsId = 'elevenlabs',
    readonly label = 'ElevenLabs',
    readonly supportsCues = true,
  ) {}
  async configured(): Promise<boolean> {
    return true;
  }
  async synthesize(req: TtsRequest): Promise<TtsAudio> {
    this.requests.push(req);
    if (this.fail) throw new Error('tts down');
    return {
      mime: 'audio/mpeg',
      chunks: (async function* () {
        yield new Uint8Array([1, 2, 3]);
        yield new Uint8Array([4, 5]);
      })(),
    };
  }
}

export const ttsRegistry = (...p: TtsProvider[]): TtsRegistry => ({
  get: (id) => p.find((x) => x.id === id),
  list: () => p,
});

/** Scripted agent driver: emits `events`, then waits on `gate` (if any) before finishing with `result`. */
export class FakeDriver implements AgentDriver {
  readonly runs: AgentRunOptions[] = [];
  label = 'Fake';
  gate: Promise<void> | null = null;
  private release: (() => void) | null = null;
  events: AgentEvent[] = [{ type: 'session-id', id: 'agent-1' }];
  result: AgentEvent = { type: 'result', text: 'All done.', isError: false };
  beforeResult: ((opts: AgentRunOptions) => Promise<void>) | null = null;
  constructor(readonly id: AgentId = 'claude') {}
  hold(): void {
    this.gate = new Promise((r) => {
      this.release = r;
    });
  }
  finish(): void {
    this.release?.();
    this.gate = null;
  }
  async available(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: 'fake' };
  }
  async *run(opts: AgentRunOptions): AsyncIterable<AgentEvent> {
    this.runs.push(opts);
    for (const e of this.events) yield e;
    if (this.beforeResult) await this.beforeResult(opts);
    if (this.gate) {
      await Promise.race([
        this.gate,
        new Promise<void>((r) => opts.signal.addEventListener('abort', () => r(), { once: true })),
      ]);
    }
    if (opts.signal.aborted) {
      yield { type: 'result', text: 'Stopped.', isError: true };
      return;
    }
    yield this.result;
    yield { type: 'exit', code: 0 };
  }
}

export const nullInspector: ProcessInspector = {
  startTime: async () => null,
  killTree: async () => undefined,
};

export interface TestApp {
  app: App;
  store: Store;
  host: FakeHost;
  ui: FakeUi;
  logger: MemoryLogger;
  brain: FakeBrain;
  secrets: MemorySecretStore;
  drivers: Record<AgentId, FakeDriver>;
  dataDir: string;
}

export async function makeApp(
  opts: {
    settings?: Partial<Settings>;
    brains?: BrainProvider[];
    tts?: TtsProvider[];
    approvalTimeoutMs?: number;
    inspector?: ProcessInspector;
    store?: Store;
    dataDir?: string;
    relay?: AppDeps['relay'];
  } = {},
): Promise<TestApp> {
  const dataDir = opts.dataDir ?? tmp();
  const store = opts.store ?? new Store(await openDatabase(':memory:'), { flushMs: 20 });
  const brain = new FakeBrain();
  const host = new FakeHost();
  const ui = new FakeUi();
  const logger = new MemoryLogger();
  const secrets = new MemorySecretStore();
  const drivers = { claude: new FakeDriver('claude'), codex: new FakeDriver('codex'), home: new FakeDriver('home') };
  const current = store.getSettings();
  store.saveSettings({
    ...current,
    primaryBrain: 'chatgpt',
    generalWorkspace: join(dataDir, 'general'),
    projectsRoot: join(dataDir, 'projects'),
    conversationMode: false,
    ...opts.settings,
  });
  const app = new App({
    store,
    host,
    ui,
    logger,
    secrets,
    dataDir,
    brains: brainRegistry(...(opts.brains ?? [brain])),
    tts: ttsRegistry(...(opts.tts ?? [])),
    stt: emptySttRegistry(),
    drivers,
    inspector: opts.inspector ?? nullInspector,
    approvalTimeoutMs: opts.approvalTimeoutMs ?? 2000,
    timeZone: 'UTC',
    ...(opts.relay ? { relay: opts.relay } : {}),
  });
  host.onPlaybackEnded = (id) => app.voice.onPlaybackEnded(id);
  return { app, store, host, ui, logger, brain, secrets, drivers, dataDir };
}
