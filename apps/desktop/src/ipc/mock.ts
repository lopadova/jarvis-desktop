/**
 * In-browser mock backend (mock mode). Speaks the same `Transport` interface as the real RPC client,
 * keeps a small in-memory state and emits `ui.*` notifications, so every surface is usable with
 * `pnpm --filter @jarvis/desktop dev` in a plain browser and in tests.
 *
 * Demo hooks: a submitted text containing "delete"/"elimina" raises a high-risk approval, one
 * containing "build" a medium-risk approval.
 */
import { type AppMethod, type AppParams, mergeSettings, type Settings } from '@jarvis/core';
import { type MockSnapshot, mockApproval, mockSnapshot } from '../mocks';
import type { ChatMessage, Locale, PillEvent } from '../types/ui';
import type { ConnectionStatus, NotificationHandler, StatusHandler, Transport } from './client';

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export class MockTransport implements Transport {
  private state: MockSnapshot;
  private readonly notificationHandlers = new Set<NotificationHandler>();
  private readonly statusHandlers = new Set<StatusHandler>();
  private status: ConnectionStatus = 'closed';
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    locale: Locale = 'en',
    private readonly delayMs = 600,
  ) {
    this.state = mockSnapshot(locale);
  }

  start(): void {
    this.setStatus('open');
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.setStatus('closed');
  }

  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    handler(this.status);
    return () => this.statusHandlers.delete(handler);
  }

  /** Push a notification as if it came from the sidecar (used by tests and the demo). */
  emit(method: string, params: unknown): void {
    for (const h of this.notificationHandlers) h(method, params);
  }

  async call<M extends AppMethod>(method: M, params: AppParams<M>): Promise<unknown> {
    const p = params as Record<string, unknown>;
    const s = this.state;
    switch (method) {
      case 'app.hello':
        return { role: 'ui', version: s.version, privateMode: s.pill.privateMode };
      case 'app.state': {
        const { suggestions: _s, ...rest } = s;
        return rest;
      }
      case 'suggestions.list':
        return { suggestions: s.suggestions };
      case 'settings.get':
        return { settings: s.settings };
      case 'settings.update': {
        s.settings = mergeSettings(s.settings, p.patch as Record<string, unknown>);
        this.emit('ui.settings', { settings: s.settings });
        if ('privateMode' in (p.patch as object)) this.setPill({ ...s.pill, privateMode: s.settings.privateMode });
        return { settings: s.settings };
      }
      case 'providers.status':
        return { providers: s.providers };
      case 'providers.setPrimary': {
        s.providers = s.providers.map((x) => ({ ...x, primary: x.id === p.brain }));
        this.emit('ui.providers', { providers: s.providers });
        return { ok: true };
      }
      case 'providers.signIn':
      case 'providers.signOut':
        return { ok: true };
      case 'secrets.set':
      case 'secrets.delete':
        // Never persisted in the mock: secrets only ever live in the OS keyring (R6).
        return { ok: true };
      case 'turn.submit':
        this.submit(String(p.text), p.source as 'voice' | 'text' | 'chip');
        return { ok: true };
      case 'voice.stopSpeaking':
        this.setPill({ ...s.pill, state: { kind: 'hidden' } });
        return { ok: true };
      case 'approval.decide': {
        const req = s.pending.find((r) => r.id === p.id);
        if (!req) return { ok: false, reason: 'unknown approval' };
        if (req.risk === 'high' && (p.via === 'voice' || p.decision === 'always-allow-project'))
          return { ok: false, reason: 'high risk needs a click and cannot be always-allowed' };
        s.pending = s.pending.filter((r) => r.id !== p.id);
        this.emit('ui.approval', { pending: s.pending, state: 'resolved', id: p.id, decision: p.decision, via: p.via });
        this.setPill({ ...s.pill, state: { kind: 'hidden' } });
        return { ok: true };
      }
      case 'session.stop':
      case 'session.dismiss':
      case 'session.clearFinished': {
        if (method === 'session.clearFinished')
          s.sessions = s.sessions.filter((x) => ['running', 'needs-input', 'approval'].includes(x.status));
        else if (method === 'session.dismiss') s.sessions = s.sessions.filter((x) => x.id !== p.id);
        else
          s.sessions = s.sessions.map((x) =>
            x.id === p.id ? { ...x, status: 'cancelled', finishedAt: Date.now() } : x,
          );
        this.emit('ui.sessions', { sessions: s.sessions });
        return { ok: true };
      }
      case 'relay.pair': {
        const code = 'K7Q2M9XD';
        s.relay = {
          status: 'connecting',
          relayUrl: String(p.relayUrl),
          pairId: 'pair-mock',
          code,
          qr: `${String(p.relayUrl)}/connect?pair=pair-mock`,
        };
        this.emit('ui.relay', s.relay);
        return { code, qr: s.relay.qr, pairId: s.relay.pairId, relayUrl: s.relay.relayUrl };
      }
      case 'relay.unpair':
        s.relay = { status: 'unpaired' };
        this.emit('ui.relay', s.relay);
        return { ok: true };
      case 'relay.status':
        return s.relay;
      case 'projects.list':
        return {
          projects: [
            {
              id: 'p1',
              name: 'shop',
              path: '~/Projects/shop',
              aliases: [],
              defaultAgent: 'claude',
              permission: 'safe',
              allowlist: [],
            },
          ],
        };
      case 'memory.list':
        return { memories: [] };
      case 'history.list':
        return { turns: [] };
      case 'reminders.list':
        return { reminders: s.reminders };
      default:
        return { ok: true };
    }
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const h of this.statusHandlers) h(status);
  }

  private setPill(pill: PillEvent): void {
    this.state.pill = pill;
    this.emit('ui.pill', pill);
  }

  private pushChat(message: ChatMessage): void {
    this.state.chat = [...this.state.chat, message];
    this.emit('ui.chat', { message });
  }

  private later(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  private submit(text: string, source: 'voice' | 'text' | 'chip'): void {
    const s = this.state;
    const locale = s.settings.locale;
    this.pushChat({ id: uid('u'), role: 'user', text, at: Date.now(), viaVoice: source === 'voice' });
    this.setPill({ ...s.pill, state: { kind: 'thinking', transcript: text, brain: 'chatgpt' } });
    const lower = text.toLowerCase();
    const risk = /delete|elimina/.test(lower) ? 'high' : /build/.test(lower) ? 'medium' : null;
    this.later(() => {
      if (risk) {
        const request = { ...mockApproval(locale, risk), id: uid('appr') };
        s.pending = [...s.pending, request];
        this.emit('ui.approval', { pending: s.pending, state: 'pending', request });
        this.setPill({ ...s.pill, state: { kind: 'approval', request } });
        this.pushChat({ id: uid('c'), role: 'system', card: { type: 'approval-needed', request }, at: Date.now() });
        return;
      }
      const reply = locale === 'it' ? `Ok — (demo) ho ricevuto: "${text}".` : `Okay — (demo) I heard: "${text}".`;
      this.pushChat({ id: uid('j'), role: 'jarvis', text: reply, at: Date.now(), spoken: true });
      this.setPill({ ...s.pill, state: { kind: 'speaking', text: reply, progress: 0, level: 0.4 } });
      this.later(() => this.setPill({ ...s.pill, state: { kind: 'hidden' } }), 2500);
    }, this.delayMs);
  }

  /** Test/demo helper: replace part of the mock state (does not emit). */
  patch(partial: Partial<MockSnapshot>): void {
    this.state = { ...this.state, ...partial };
  }

  get snapshot(): MockSnapshot {
    return this.state;
  }

  setSettings(settings: Settings): void {
    this.state.settings = settings;
  }
}
