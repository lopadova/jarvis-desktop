/**
 * Reminders, timers and alarms persisted in SQLite. Survive restarts: on start every pending item is
 * (re)scheduled and overdue ones fire immediately. Firing speaks a phrase and shows a notification.
 */
import { type Logger, phrases, type Reminder, type Settings } from '@jarvis/core';
import type { HostClient, UiSink } from './host.js';
import type { Store } from './store/store.js';
import { newId } from './util.js';

/** setTimeout cannot exceed ~24.8 days; long waits re-arm in steps. */
const MAX_DELAY = 6 * 60 * 60 * 1000;

export interface ReminderDeps {
  store: Store;
  host: HostClient;
  ui: UiSink;
  settings: () => Settings;
  logger: Logger;
  speak: (text: string) => Promise<void> | void;
  now?: () => number;
}

export class ReminderScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;
  private started = false;

  constructor(private readonly deps: ReminderDeps) {
    this.now = deps.now ?? Date.now;
  }

  start(): void {
    this.started = true;
    this.arm();
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  list(): Reminder[] {
    return this.deps.store.listReminders(false);
  }

  add(text: string, dueAt: number, kind: Reminder['kind']): Reminder {
    const r: Reminder = { id: newId('r_'), text: text.slice(0, 300), dueAt, kind, done: false };
    this.deps.store.addReminder(r);
    this.publish();
    this.arm();
    return r;
  }

  cancel(id: string): boolean {
    const ok = this.deps.store.deleteReminder(id);
    this.publish();
    this.arm();
    return ok;
  }

  publish(): void {
    this.deps.ui.emit('ui.reminders', { reminders: this.list() });
  }

  private arm(): void {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const next = this.list()[0];
    if (!next) return;
    const delay = Math.max(0, Math.min(MAX_DELAY, next.dueAt - this.now()));
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.fireDue();
    }, delay);
    this.timer.unref?.();
  }

  /** Fires every reminder that is due (public for tests). */
  async fireDue(): Promise<Reminder[]> {
    const due = this.list().filter((r) => r.dueAt <= this.now());
    for (const r of due) {
      this.deps.store.markReminderDone(r.id);
      const p = phrases(this.deps.settings().locale);
      const line = r.kind === 'timer' ? p.timerFire(r.text) : r.kind === 'alarm' ? p.alarmFire : p.reminderFire(r.text);
      this.deps.logger.info('reminder fired', { id: r.id, kind: r.kind });
      if (this.deps.host.connected) {
        void this.deps.host
          .call('host.notify', { title: 'Jarvis', body: line.replace(/\[[a-z -]+\]\s*/gi, '') })
          .catch(() => undefined);
      }
      await this.deps.speak(line);
    }
    if (due.length) this.publish();
    this.arm();
    return due;
  }
}

/** Next occurrence of hh:mm in local time (today if still ahead, else tomorrow). */
export function nextClockTime(hour: number, minute: number, now = new Date()): number {
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d.getTime();
}
