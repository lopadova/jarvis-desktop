import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nextClockTime } from '../src/reminders.js';
import { openDatabase } from '../src/store/sqlite.js';
import { Store } from '../src/store/store.js';
import { makeApp, tick, tmp, until } from './helpers.js';

describe('reminders', () => {
  it('persist across restarts and fire overdue items on start', async () => {
    const file = join(tmp(), 'jarvis.db');
    const s1 = new Store(await openDatabase(file));
    const t1 = await makeApp({ store: s1 });
    t1.app.reminders.add('call Marco', Date.now() + 60_000, 'reminder');
    t1.app.reminders.add('tea', Date.now() + 120_000, 'timer');
    s1.close();

    // "Restart": a new process opens the same DB later, when the first reminder is overdue.
    const s2 = new Store(await openDatabase(file));
    const pending = s2.listReminders();
    expect(pending.map((r) => r.text)).toEqual(['call Marco', 'tea']);
    s2.db.run('UPDATE reminders SET due_at = ? WHERE text = ?', Date.now() - 1000, 'call Marco');
    const t2 = await makeApp({ store: s2 });
    t2.app.reminders.start();
    await until(() => t2.host.spoken().some((x) => x.includes('Reminder: call Marco')));
    expect(t2.host.of('host.notify')).toEqual([{ title: 'Jarvis', body: 'Reminder: call Marco.' }]);
    expect(t2.app.reminders.list().map((r) => r.text)).toEqual(['tea']);
    t2.app.reminders.stop();
  });

  it('fires timers when due', async () => {
    const t = await makeApp();
    t.app.reminders.start();
    t.app.reminders.add('pasta', Date.now() + 30, 'timer');
    await until(() => t.host.spoken().length > 0);
    expect(t.host.spoken()[0]).toBe('Your pasta timer is done.');
    expect(t.ui.last<{ reminders: unknown[] }>('ui.reminders')?.reminders).toEqual([]);
    t.app.reminders.stop();
  });

  it('cancel removes a reminder', async () => {
    const t = await makeApp();
    const r = t.app.reminders.add('x', Date.now() + 100_000, 'reminder');
    expect(t.app.reminders.cancel(r.id)).toBe(true);
    expect(t.app.reminders.list()).toEqual([]);
    await tick(1);
  });

  it('computes the next clock time', () => {
    const now = new Date(2026, 9, 3, 8, 0, 0);
    expect(new Date(nextClockTime(7, 30, now)).getDate()).toBe(4);
    expect(new Date(nextClockTime(9, 15, now)).getHours()).toBe(9);
  });
});
