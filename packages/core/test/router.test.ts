import { describe, expect, it } from 'vitest';
import {
  addMemory,
  allSuggestions,
  defaultSettings,
  extractJsonObject,
  matchFastIntent,
  mergeSettings,
  parseRouterAction,
  parseYesNo,
  ROUTER_ACTIONS,
  RouterActionSchema,
  routerJsonSchema,
  spokenDuration,
  suggestionsFor,
} from '../src/index.js';

describe('router schema', () => {
  it('json schema mirrors the zod schema keys', () => {
    expect(Object.keys(routerJsonSchema.properties).sort()).toEqual(Object.keys(RouterActionSchema.shape).sort());
    expect(routerJsonSchema.properties.action.enum).toEqual([...ROUTER_ACTIONS]);
  });
  it('parses JSON wrapped in prose and fences', () => {
    const r = parseRouterAction('Sure!\n```json\n{"action":"answer","speak":"It is {fine}","task":null}\n```');
    expect(r.ok && r.action.speak).toBe('It is {fine}');
  });
  it('rejects unknown actions', () => {
    expect(parseRouterAction({ action: 'rm', speak: '' }).ok).toBe(false);
    expect(parseRouterAction('nothing here').ok).toBe(false);
  });
  it('extracts balanced objects with braces in strings', () => {
    expect(extractJsonObject('x {"a":"}"} y')).toBe('{"a":"}"}');
  });
});

describe('fast path', () => {
  it.each([
    ['Jarvis, stop', 'stop-speaking'],
    ['basta', 'stop-speaking'],
    ['annulla tutto', 'cancel-all'],
    ['a che punto sei?', 'status'],
    ["how's it going", 'status'],
    ['che ore sono', 'time'],
    ['ripeti', 'repeat'],
    ['passa alla modalità locale', 'private-mode'],
  ])('%s → %s', (u, kind) => expect(matchFastIntent(u)?.kind).toBe(kind));

  it('parses timers in both languages', () => {
    expect(matchFastIntent('timer di 10 minuti')).toEqual({ kind: 'timer', seconds: 600, label: '' });
    expect(matchFastIntent('set a timer for 1 hour 30 minutes')).toMatchObject({ kind: 'timer', seconds: 5400 });
    expect(matchFastIntent("metti un timer di un'ora e mezza")).toMatchObject({ kind: 'timer', seconds: 5400 });
    expect(matchFastIntent('timer for twenty seconds')).toMatchObject({ kind: 'timer', seconds: 20 });
  });
  it('parses reminders and alarms', () => {
    expect(matchFastIntent('ricordami tra 20 minuti di chiamare Marco')).toEqual({
      kind: 'reminder',
      inSeconds: 1200,
      text: 'chiamare marco',
    });
    expect(matchFastIntent('remind me in 5 minutes to check the oven')).toEqual({
      kind: 'reminder',
      inSeconds: 300,
      text: 'check the oven',
    });
    expect(matchFastIntent('sveglia alle 7:30')).toEqual({ kind: 'alarm', at: { hour: 7, minute: 30 } });
    expect(matchFastIntent('wake me up at 6 pm')).toEqual({ kind: 'alarm', at: { hour: 18, minute: 0 } });
    expect(matchFastIntent('alarm at 7.45 pm')).toEqual({ kind: 'alarm', at: { hour: 19, minute: 45 } });
    expect(matchFastIntent('sveglia alle 7.30')).toEqual({ kind: 'alarm', at: { hour: 7, minute: 30 } });
    expect(matchFastIntent('timer for 1.5 hours')).toMatchObject({ kind: 'timer', seconds: 5400 });
    expect(matchFastIntent('timer di 2,5 minuti')).toMatchObject({ kind: 'timer', seconds: 150 });
  });
  it('leaves real requests to the brain', () => {
    expect(matchFastIntent('nel progetto shop aggiungi il footer')).toBeNull();
    expect(matchFastIntent('stop the shop session and start a new one')).toBeNull();
  });
});

describe('helpers', () => {
  it('spoken durations', () => {
    expect(spokenDuration(40, 'en')).toBe('40 seconds');
    expect(spokenDuration(3900, 'it')).toBe('un’ora e 5 minuti');
  });
  it('yes/no', () => {
    expect(parseYesNo('Sì, procedi')).toBeNull();
    expect(parseYesNo('sì')).toBe('yes');
    expect(parseYesNo('go ahead')).toBe('yes');
    expect(parseYesNo('no grazie')).toBe('no');
  });
  it('memory de-duplicates', () => {
    let n = 0;
    const mk = () => `m${++n}`;
    const l = addMemory(addMemory([], 'Prefers Tailwind', mk), 'prefers tailwind!', mk);
    expect(l).toHaveLength(1);
  });
  it('suggestions respect capabilities and locale', () => {
    const s = suggestionsFor({ locale: 'it', hour: 8, capabilities: new Set(['agent']) }, 50);
    expect(s[0]?.id).toBe('briefing');
    expect(s.find((x) => x.requires?.includes('developer'))).toBeUndefined();
    expect(allSuggestions('it').every((x) => x.utterance.startsWith('Jarvis'))).toBe(true);
  });
  it('settings defaults and merge', () => {
    const d = defaultSettings();
    expect(d.tts).toBe('system');
    expect(mergeSettings(d, { locale: 'it', bogus: 1 }).locale).toBe('it');
    expect(() => mergeSettings(d, { maxConcurrentSessions: 99 })).toThrow();
  });
});
