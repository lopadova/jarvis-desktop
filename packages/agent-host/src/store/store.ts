/**
 * Persistent state in one SQLite file (product-spec §8). Versioned migrations via `PRAGMA user_version`.
 * High-frequency updates (session activity) go through `BatchedWriter`, never one synchronous write per
 * stream event (R8 reliability).
 */
import {
  type AgentId,
  type ApprovalDecision,
  type ApprovalKind,
  type ChatMessage,
  defaultSettings,
  type Memory,
  type PermissionLevel,
  type Project,
  type Reminder,
  type RiskLevel,
  type Session,
  type SessionStatus,
  type Settings,
  SettingsSchema,
  type Turn,
} from '@jarvis/core';
import type { SqlDb, SqlValue } from './sqlite.js';

export const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
  CREATE TABLE projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '[]',
    default_agent TEXT NOT NULL, permission TEXT NOT NULL DEFAULT 'safe', allowlist TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, agent TEXT NOT NULL, project_id TEXT, project TEXT NOT NULL, cwd TEXT NOT NULL,
    task TEXT NOT NULL, status TEXT NOT NULL, activity TEXT, started_at INTEGER NOT NULL, finished_at INTEGER,
    agent_session_id TEXT, result_text TEXT, result_url TEXT, coding INTEGER NOT NULL DEFAULT 0,
    dismissed INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE memories (id TEXT PRIMARY KEY, text TEXT NOT NULL, created_at INTEGER NOT NULL, source TEXT NOT NULL);
  CREATE TABLE turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, heard TEXT NOT NULL, said TEXT NOT NULL,
    action TEXT NOT NULL, task TEXT, project TEXT
  );
  CREATE INDEX turns_at ON turns(at);
  CREATE TABLE reminders (
    id TEXT PRIMARY KEY, text TEXT NOT NULL, due_at INTEGER NOT NULL, kind TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE approvals (
    id TEXT PRIMARY KEY, session_id TEXT, agent TEXT, project TEXT, kind TEXT NOT NULL, risk TEXT NOT NULL,
    title TEXT NOT NULL, detail TEXT NOT NULL, decision TEXT, via TEXT, created_at INTEGER NOT NULL, decided_at INTEGER
  );
  CREATE TABLE approval_rules (
    project_key TEXT NOT NULL, kind TEXT NOT NULL, pattern TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY (project_key, kind, pattern)
  );
  CREATE TABLE chat_messages (id TEXT PRIMARY KEY, at INTEGER NOT NULL, json TEXT NOT NULL);
  CREATE INDEX chat_at ON chat_messages(at);
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  // v2 — process bookkeeping for orphan reaping (R7)
  `
  ALTER TABLE sessions ADD COLUMN pid INTEGER;
  ALTER TABLE sessions ADD COLUMN pid_start INTEGER;
  `,
];

export function migrate(db: SqlDb): number {
  const row = db.get<{ user_version: number }>('PRAGMA user_version');
  let version = Number(row?.user_version ?? 0);
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version] as string;
    const next = version + 1;
    db.transaction(() => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${next}`);
    });
    version = next;
  }
  return version;
}

interface SessionRow {
  id: string;
  agent: string;
  project_id: string | null;
  project: string;
  cwd: string;
  task: string;
  status: string;
  activity: string | null;
  started_at: number;
  finished_at: number | null;
  agent_session_id: string | null;
  result_text: string | null;
  result_url: string | null;
  coding: number;
  dismissed: number;
  pid: number | null;
  pid_start: number | null;
}

function rowToSession(r: SessionRow): Session {
  const s: Session = {
    id: r.id,
    agent: r.agent as AgentId,
    projectId: r.project_id,
    project: r.project,
    cwd: r.cwd,
    task: r.task,
    status: r.status as SessionStatus,
    startedAt: Number(r.started_at),
    coding: !!r.coding,
    dismissed: !!r.dismissed,
  };
  if (r.activity !== null) s.activity = r.activity;
  if (r.finished_at !== null) s.finishedAt = Number(r.finished_at);
  if (r.agent_session_id !== null) s.agentSessionId = r.agent_session_id;
  if (r.result_text !== null) s.resultText = r.result_text;
  if (r.result_url !== null) s.resultUrl = r.result_url;
  return s;
}

export interface ApprovalAudit {
  id: string;
  sessionId?: string;
  agent?: AgentId;
  project?: string;
  kind: ApprovalKind;
  risk: RiskLevel;
  title: string;
  detail: string;
  createdAt: number;
}

export class Store {
  readonly writer: BatchedWriter;
  private settingsCache: Settings | null = null;

  constructor(
    readonly db: SqlDb,
    opts: { flushMs?: number } = {},
  ) {
    migrate(db);
    this.writer = new BatchedWriter(db, opts.flushMs ?? 500);
  }

  close(): void {
    this.writer.flush();
    this.writer.stop();
    this.db.close();
  }

  // ───────── settings ─────────
  getSettings(): Settings {
    if (this.settingsCache) return this.settingsCache;
    const row = this.db.get<{ json: string }>('SELECT json FROM settings WHERE id = 1');
    let s = defaultSettings();
    if (row) {
      try {
        const parsed = SettingsSchema.safeParse(JSON.parse(row.json));
        if (parsed.success) s = parsed.data;
      } catch {
        /* corrupted row: fall back to defaults */
      }
    }
    this.settingsCache = s;
    return s;
  }
  saveSettings(s: Settings): Settings {
    const valid = SettingsSchema.parse(s);
    this.db.run(
      'INSERT INTO settings (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json',
      JSON.stringify(valid),
    );
    this.settingsCache = valid;
    return valid;
  }

  // ───────── projects ─────────
  listProjects(): Project[] {
    return this.db
      .all<{
        id: string;
        name: string;
        path: string;
        aliases: string;
        default_agent: string;
        permission: string;
        allowlist: string;
      }>('SELECT * FROM projects ORDER BY name COLLATE NOCASE')
      .map((r) => ({
        id: r.id,
        name: r.name,
        path: r.path,
        aliases: JSON.parse(r.aliases) as string[],
        defaultAgent: r.default_agent as AgentId,
        permission: r.permission as PermissionLevel,
        allowlist: JSON.parse(r.allowlist) as string[],
      }));
  }
  upsertProject(p: Project): void {
    this.db.run(
      `INSERT INTO projects (id, name, path, aliases, default_agent, permission, allowlist) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, path=excluded.path, aliases=excluded.aliases,
       default_agent=excluded.default_agent, permission=excluded.permission, allowlist=excluded.allowlist`,
      p.id,
      p.name,
      p.path,
      JSON.stringify(p.aliases),
      p.defaultAgent,
      p.permission,
      JSON.stringify(p.allowlist),
    );
  }
  removeProject(id: string): void {
    this.db.run('DELETE FROM projects WHERE id = ?', id);
  }

  // ───────── sessions ─────────
  listSessions(limit = 200): Session[] {
    this.writer.flush();
    return this.db.all<SessionRow>('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?', limit).map(rowToSession);
  }
  saveSession(s: Session): void {
    this.writer.drop(`session-activity:${s.id}`);
    this.db.run(
      `INSERT INTO sessions (id, agent, project_id, project, cwd, task, status, activity, started_at, finished_at,
        agent_session_id, result_text, result_url, coding, dismissed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status=excluded.status, activity=excluded.activity,
        finished_at=excluded.finished_at, agent_session_id=excluded.agent_session_id,
        result_text=excluded.result_text, result_url=excluded.result_url, dismissed=excluded.dismissed,
        task=excluded.task`,
      s.id,
      s.agent,
      s.projectId,
      s.project,
      s.cwd,
      s.task,
      s.status,
      s.activity ?? null,
      s.startedAt,
      s.finishedAt ?? null,
      s.agentSessionId ?? null,
      s.resultText ?? null,
      s.resultUrl ?? null,
      s.coding ? 1 : 0,
      s.dismissed ? 1 : 0,
    );
  }
  /** Debounced: the latest activity wins, written in one transaction per flush. */
  queueSessionActivity(id: string, activity: string): void {
    this.writer.queue(`session-activity:${id}`, 'UPDATE sessions SET activity = ? WHERE id = ?', [activity, id]);
  }
  setSessionProcess(id: string, pid: number | null, startTime: number | null): void {
    this.db.run('UPDATE sessions SET pid = ?, pid_start = ? WHERE id = ?', pid, startTime, id);
  }
  /** Sessions that still had a process when the sidecar last stopped. */
  sessionsWithProcess(): { id: string; pid: number; startTime: number; status: SessionStatus }[] {
    return this.db
      .all<{ id: string; pid: number; pid_start: number; status: string }>(
        'SELECT id, pid, pid_start, status FROM sessions WHERE pid IS NOT NULL',
      )
      .map((r) => ({
        id: r.id,
        pid: Number(r.pid),
        startTime: Number(r.pid_start),
        status: r.status as SessionStatus,
      }));
  }
  deleteSessions(ids: string[]): void {
    this.db.transaction(() => {
      for (const id of ids) this.db.run('DELETE FROM sessions WHERE id = ?', id);
    });
  }

  // ───────── memories ─────────
  listMemories(): Memory[] {
    return this.db
      .all<{ id: string; text: string; created_at: number; source: string }>(
        'SELECT * FROM memories ORDER BY created_at ASC',
      )
      .map((r) => ({
        id: r.id,
        text: r.text,
        createdAt: Number(r.created_at),
        source: r.source as Memory['source'],
      }));
  }
  replaceMemories(list: Memory[]): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM memories');
      for (const m of list)
        this.db.run(
          'INSERT INTO memories (id, text, created_at, source) VALUES (?, ?, ?, ?)',
          m.id,
          m.text,
          m.createdAt,
          m.source,
        );
    });
  }

  // ───────── turns / history ─────────
  addTurn(t: Turn): void {
    this.db.run(
      'INSERT INTO turns (at, heard, said, action, task, project) VALUES (?, ?, ?, ?, ?, ?)',
      t.at,
      t.heard,
      t.said,
      t.action,
      t.task ?? null,
      t.project ?? null,
    );
  }
  recentTurns(limit = 10): Turn[] {
    return this.listTurns(undefined, limit).reverse();
  }
  listTurns(query?: string, limit = 100): Turn[] {
    const rows = query
      ? this.db.all<Record<string, unknown>>(
          'SELECT * FROM turns WHERE heard LIKE ? OR said LIKE ? ORDER BY at DESC LIMIT ?',
          `%${query}%`,
          `%${query}%`,
          limit,
        )
      : this.db.all<Record<string, unknown>>('SELECT * FROM turns ORDER BY at DESC LIMIT ?', limit);
    return rows.map((r) => {
      const t: Turn = {
        at: Number(r.at),
        heard: String(r.heard),
        said: String(r.said),
        action: String(r.action),
      };
      if (r.task) t.task = String(r.task);
      if (r.project) t.project = String(r.project);
      return t;
    });
  }
  clearHistory(since: number): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM turns WHERE at >= ?', since);
      this.db.run('DELETE FROM chat_messages WHERE at >= ?', since);
    });
  }
  pruneHistory(olderThan: number): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM turns WHERE at < ?', olderThan);
      this.db.run('DELETE FROM chat_messages WHERE at < ?', olderThan);
    });
  }

  // ───────── chat ─────────
  addChat(m: ChatMessage): void {
    this.db.run('INSERT OR REPLACE INTO chat_messages (id, at, json) VALUES (?, ?, ?)', m.id, m.at, JSON.stringify(m));
  }
  recentChat(limit = 100): ChatMessage[] {
    return this.db
      .all<{ json: string }>('SELECT json FROM chat_messages ORDER BY at DESC LIMIT ?', limit)
      .map((r) => JSON.parse(r.json) as ChatMessage)
      .reverse();
  }

  // ───────── reminders ─────────
  addReminder(r: Reminder): void {
    this.db.run(
      'INSERT INTO reminders (id, text, due_at, kind, done) VALUES (?, ?, ?, ?, ?)',
      r.id,
      r.text,
      r.dueAt,
      r.kind,
      r.done ? 1 : 0,
    );
  }
  listReminders(includeDone = false): Reminder[] {
    const sql = includeDone
      ? 'SELECT * FROM reminders ORDER BY due_at ASC'
      : 'SELECT * FROM reminders WHERE done = 0 ORDER BY due_at ASC';
    return this.db.all<{ id: string; text: string; due_at: number; kind: string; done: number }>(sql).map((r) => ({
      id: r.id,
      text: r.text,
      dueAt: Number(r.due_at),
      kind: r.kind as Reminder['kind'],
      done: !!r.done,
    }));
  }
  markReminderDone(id: string): void {
    this.db.run('UPDATE reminders SET done = 1 WHERE id = ?', id);
  }
  deleteReminder(id: string): boolean {
    return this.db.run('DELETE FROM reminders WHERE id = ?', id).changes > 0;
  }

  // ───────── approvals (audit + rules) ─────────
  auditApprovalRequest(a: ApprovalAudit): void {
    this.db.run(
      `INSERT INTO approvals (id, session_id, agent, project, kind, risk, title, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      a.id,
      a.sessionId ?? null,
      a.agent ?? null,
      a.project ?? null,
      a.kind,
      a.risk,
      a.title,
      a.detail,
      a.createdAt,
    );
  }
  auditApprovalDecision(id: string, decision: ApprovalDecision, via: string, at: number): void {
    this.db.run('UPDATE approvals SET decision = ?, via = ?, decided_at = ? WHERE id = ?', decision, via, at, id);
  }
  listApprovalAudit(limit = 100): Record<string, unknown>[] {
    return this.db.all('SELECT * FROM approvals ORDER BY created_at DESC LIMIT ?', limit);
  }
  addApprovalRule(projectKey: string, kind: ApprovalKind, pattern: string, at: number): void {
    this.db.run(
      'INSERT OR IGNORE INTO approval_rules (project_key, kind, pattern, created_at) VALUES (?, ?, ?, ?)',
      projectKey,
      kind,
      pattern,
      at,
    );
  }
  hasApprovalRule(projectKey: string, kind: ApprovalKind, pattern: string): boolean {
    return !!this.db.get(
      'SELECT 1 AS x FROM approval_rules WHERE project_key = ? AND kind = ? AND pattern = ?',
      projectKey,
      kind,
      pattern,
    );
  }

  // ───────── kv ─────────
  kvGet(key: string): string | null {
    return this.db.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', key)?.value ?? null;
  }
  kvSet(key: string, value: string): void {
    this.db.run(
      'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }
}

/**
 * Coalesces keyed writes (latest wins) and flushes them in one transaction every `intervalMs`.
 * `flush()` is also called before reads that depend on the queued data and on shutdown.
 */
export class BatchedWriter {
  private readonly pending = new Map<string, { sql: string; params: SqlValue[] }>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  flushes = 0;

  constructor(
    private readonly db: SqlDb,
    private readonly intervalMs: number,
  ) {}

  queue(key: string, sql: string, params: SqlValue[]): void {
    this.pending.set(key, { sql, params });
    if (!this.timer && this.intervalMs >= 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, this.intervalMs);
      this.timer.unref?.();
    }
  }
  drop(key: string): void {
    this.pending.delete(key);
  }
  get size(): number {
    return this.pending.size;
  }
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pending.size) return;
    const items = [...this.pending.values()];
    this.pending.clear();
    this.db.transaction(() => {
      for (const it of items) this.db.run(it.sql, ...it.params);
    });
    this.flushes++;
  }
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
