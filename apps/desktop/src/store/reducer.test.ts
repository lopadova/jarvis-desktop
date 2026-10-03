import { describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import it_ from '../i18n/it.json';
import { MockTransport } from '../ipc/mock';
import { mockApproval, mockSessions, mockSnapshot } from '../mocks';
import type { ChatMessage } from '../types/ui';
import { applySnapshot, applyUiEvent, dismissToast, initialState, upsertChat } from './reducer';

describe('reducer', () => {
  it('applies the app.state snapshot', () => {
    const snap = mockSnapshot('en', 0);
    const s = applySnapshot(initialState(), snap);
    expect(s.ready).toBe(true);
    expect(s.sessions).toHaveLength(3);
    expect(s.settings.userName).toBe('Lorenzo');
    expect(s.version).toBe('0.1.0-mock');
  });

  it('handles ui.pill / ui.sessions / ui.approval / ui.providers / ui.settings / ui.relay', () => {
    let s = initialState();
    s = applyUiEvent(s, 'ui.pill', {
      state: { kind: 'listening', level: 0.5, partial: 'ti', committed: 'what' },
      privateMode: true,
    });
    expect(s.pill.state.kind).toBe('listening');
    expect(s.pill.privateMode).toBe(true);
    s = applyUiEvent(s, 'ui.sessions', { sessions: mockSessions('en', 0) });
    expect(s.sessions).toHaveLength(3);
    const req = mockApproval('en', 'high', 0);
    s = applyUiEvent(s, 'ui.approval', { pending: [req], state: 'pending', request: req });
    expect(s.pending).toEqual([req]);
    s = applyUiEvent(s, 'ui.approval', { pending: [], state: 'resolved', id: req.id, decision: 'deny', via: 'click' });
    expect(s.pending).toEqual([]);
    s = applyUiEvent(s, 'ui.providers', { providers: [{ id: 'local', connected: true, state: 'ok', primary: true }] });
    expect(s.providers[0]?.id).toBe('local');
    s = applyUiEvent(s, 'ui.settings', { settings: { ...s.settings, locale: 'it' } });
    expect(s.settings.locale).toBe('it');
    s = applyUiEvent(s, 'ui.relay', { status: 'connecting', code: 'ABCD1234', qr: 'https://r/connect?pair=1' });
    expect(s.relay.code).toBe('ABCD1234');
  });

  it('ignores malformed payloads and unknown methods', () => {
    const s = initialState();
    expect(applyUiEvent(s, 'ui.pill', null)).toBe(s);
    expect(applyUiEvent(s, 'ui.sessions', { sessions: 'nope' })).toBe(s);
    expect(applyUiEvent(s, 'ui.chat', { message: 3 })).toBe(s);
    expect(applyUiEvent(s, 'ui.unknown', {})).toBe(s);
  });

  it('upserts chat messages by id (streamed replies)', () => {
    const a: ChatMessage = { id: 'a', role: 'jarvis', text: 'Hel', at: 1, spoken: false };
    let chat = upsertChat([], a);
    chat = upsertChat(chat, { ...a, text: 'Hello' });
    chat = upsertChat(chat, { id: 'b', role: 'user', text: 'hi', at: 2, viaVoice: false });
    expect(chat.map((m) => (m.role === 'system' ? '' : m.text))).toEqual(['Hello', 'hi']);
  });

  it('keeps at most 4 toasts and dismisses by id', () => {
    let s = initialState();
    for (let i = 0; i < 6; i++) s = applyUiEvent(s, 'ui.toast', { level: i % 2 ? 'error' : 'bogus', title: `t${i}` });
    expect(s.toasts.map((t) => t.title)).toEqual(['t2', 't3', 't4', 't5']);
    expect(s.toasts[0]?.level).toBe('info');
    s = dismissToast(s, s.toasts[0]?.id ?? '');
    expect(s.toasts).toHaveLength(3);
  });
});

describe('mock backend', () => {
  it('turn.submit echoes the user and raises a high-risk approval for "delete"', async () => {
    const mock = new MockTransport('en', 0);
    const events: [string, unknown][] = [];
    mock.onNotification((m, p) => events.push([m, p]));
    mock.start();
    await mock.call('turn.submit', { text: 'delete the dist folder', source: 'text' });
    await new Promise((r) => setTimeout(r, 5));
    const methods = events.map(([m]) => m);
    expect(methods).toContain('ui.chat');
    expect(methods).toContain('ui.approval');
    const pending = mock.snapshot.pending[0];
    expect(pending?.risk).toBe('high');
    // High risk refuses voice approval (R2), accepts a click.
    expect(
      await mock.call('approval.decide', { id: pending?.id ?? '', decision: 'allow-once', via: 'voice' }),
    ).toMatchObject({ ok: false });
    expect(await mock.call('approval.decide', { id: pending?.id ?? '', decision: 'allow-once', via: 'click' })).toEqual(
      { ok: true },
    );
    mock.stop();
  });
});

describe('i18n', () => {
  it('en and it have identical keys and no empty strings', () => {
    expect(Object.keys(it_).sort()).toEqual(Object.keys(en).sort());
    for (const [k, v] of Object.entries({ ...en, ...it_ })) expect(v, k).not.toBe('');
  });
});
