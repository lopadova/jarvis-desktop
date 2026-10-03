import { join } from 'node:path';
import { defaultSettings, type Session } from '@jarvis/core';
import { describe, expect, it } from 'vitest';
import { openDatabase, type SqlDb } from '../src/store/sqlite.js';
import { MIGRATIONS, migrate, Store } from '../src/store/store.js';
import { tick, tmp } from './helpers.js';

const session = (id: string): Session => ({
  id,
  agent: 'claude',
  projectId: null,
  project: 'General',
  cwd: '/tmp',
  task: 'x',
  status: 'running',
  startedAt: 1,
  coding: false,
  dismissed: false,
});

/** Wraps a db to count transactions and statements. */
function counting(db: SqlDb): SqlDb & { tx: number; runs: number } {
  const c = Object.assign(Object.create(db) as SqlDb, { tx: 0, runs: 0 }) as SqlDb & { tx: number; runs: number };
  c.transaction = (fn) => {
    c.tx++;
    db.transaction(fn);
  };
  c.run = (sql, ...p) => {
    c.runs++;
    return db.run(sql, ...p);
  };
  return c;
}

describe('store', () => {
  it('applies versioned migrations once and is idempotent', async () => {
    const file = join(tmp(), 'jarvis.db');
    const db = await openDatabase(file);
    expect(migrate(db)).toBe(MIGRATIONS.length);
    expect(migrate(db)).toBe(MIGRATIONS.length);
    db.close();
    const again = await openDatabase(file);
    expect(again.get<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(MIGRATIONS.length);
    again.close();
  });

  it('round-trips settings through the schema (unknown keys dropped)', async () => {
    const s = new Store(await openDatabase(':memory:'));
    s.saveSettings({ ...defaultSettings(), locale: 'it', ...({ bogus: 1 } as object) });
    s.db.run('UPDATE settings SET json = ? WHERE id = 1', JSON.stringify({ locale: 'it', bogus: true }));
    const fresh = new Store(s.db);
    expect(fresh.getSettings().locale).toBe('it');
    expect((fresh.getSettings() as Record<string, unknown>).bogus).toBeUndefined();
  });

  it('batches high-frequency activity updates into one transaction (R8)', async () => {
    const raw = await openDatabase(':memory:');
    const db = counting(raw);
    const s = new Store(db, { flushMs: 30 });
    s.saveSession(session('s1'));
    const runsBefore = db.runs;
    const txBefore = db.tx;
    for (let i = 0; i < 200; i++) s.queueSessionActivity('s1', `step ${i}`);
    expect(db.runs).toBe(runsBefore); // nothing written synchronously
    await tick(60);
    expect(db.tx - txBefore).toBe(1);
    expect(db.runs - runsBefore).toBe(1); // latest value only
    expect(s.listSessions()[0]?.activity).toBe('step 199');
    expect(s.writer.flushes).toBe(1);
  });

  it('flushes pending writes before reads', async () => {
    const s = new Store(await openDatabase(':memory:'), { flushMs: 10_000 });
    s.saveSession(session('s1'));
    s.queueSessionActivity('s1', 'Editing Hero.tsx');
    expect(s.listSessions()[0]?.activity).toBe('Editing Hero.tsx');
  });

  it('stores memories, turns, chat, reminders and kv', async () => {
    const s = new Store(await openDatabase(':memory:'));
    s.replaceMemories([{ id: 'm1', text: 'likes tea', createdAt: 1, source: 'said' }]);
    expect(s.listMemories()).toHaveLength(1);
    s.addTurn({ at: 10, heard: 'hi', said: 'hello', action: 'answer' });
    expect(s.listTurns('hel')).toHaveLength(1);
    s.addChat({ id: 'c1', role: 'user', text: 'hi', at: 10, viaVoice: false });
    expect(s.recentChat()).toHaveLength(1);
    s.clearHistory(0);
    expect(s.listTurns()).toHaveLength(0);
    s.addReminder({ id: 'r1', text: 'tea', dueAt: 5, kind: 'timer', done: false });
    s.markReminderDone('r1');
    expect(s.listReminders()).toHaveLength(0);
    s.kvSet('a', 'b');
    expect(s.kvGet('a')).toBe('b');
  });
});
