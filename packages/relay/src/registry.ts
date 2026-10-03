/**
 * PairRegistry — a single SQLite-backed Durable Object with the pair records.
 *
 * Stores only: pairId, sha256(secret), the pairing code derived from that hash (so the OAuth page can
 * find the pair from the short code alone), a label, the creation time and a per-registration
 * `generation` nonce that OAuth grants are bound to. Never the secret.
 *
 * Removed pairIds leave a tombstone and can never be registered again, so a grant issued for an
 * earlier registration can't reach a new desktop.
 */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env.js';
import { type PairRegistration, pairingCodeFromHash } from './shared/pairing.js';

export interface PairRecord {
  pairId: string;
  secretHash: string;
  label: string;
  createdAt: number;
  generation: string;
}

export type RegisterOutcome = { status: 'created'; generation: string } | { status: 'conflict' | 'throttled' };

/** Brute-force guard for the pairing code (40 bits): failed lookups allowed per 10-minute window. */
const MAX_CODE_FAILURES = 30;
const CODE_WINDOW_MS = 10 * 60_000;
/** Abuse guard for open registration. */
const MAX_REGISTRATIONS_PER_HOUR = 60;

export class PairRegistry extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS pairs (
      pair_id TEXT PRIMARY KEY,
      secret_hash TEXT NOT NULL,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      generation TEXT NOT NULL
    )`);
    this.sql.exec('CREATE TABLE IF NOT EXISTS tombstones (pair_id TEXT PRIMARY KEY, removed_at INTEGER NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS pairs_code ON pairs (code)');
    this.sql.exec(`CREATE TABLE IF NOT EXISTS counters (
      key TEXT PRIMARY KEY,
      bucket INTEGER NOT NULL,
      count INTEGER NOT NULL
    )`);
  }

  /** `conflict` when the pairId (live or removed) or the pairing code is already taken. */
  register(reg: PairRegistration): RegisterOutcome {
    if (!this.bump('register', 60 * 60_000, MAX_REGISTRATIONS_PER_HOUR)) return { status: 'throttled' };
    const code = pairingCodeFromHash(reg.secretHash);
    const live = this.sql
      .exec<{ n: number }>('SELECT COUNT(*) AS n FROM pairs WHERE pair_id = ? OR code = ?', reg.pairId, code)
      .one().n;
    const removed = this.sql
      .exec<{ n: number }>('SELECT COUNT(*) AS n FROM tombstones WHERE pair_id = ?', reg.pairId)
      .one().n;
    if (live + removed > 0) return { status: 'conflict' };
    const generation = crypto.randomUUID();
    this.sql.exec(
      'INSERT INTO pairs (pair_id, secret_hash, code, label, created_at, generation) VALUES (?, ?, ?, ?, ?, ?)',
      reg.pairId,
      reg.secretHash,
      code,
      reg.label,
      Date.now(),
      generation,
    );
    return { status: 'created', generation };
  }

  get(pairId: string): PairRecord | null {
    const row = this.sql
      .exec<{ pair_id: string; secret_hash: string; label: string; created_at: number; generation: string }>(
        'SELECT pair_id, secret_hash, label, created_at, generation FROM pairs WHERE pair_id = ?',
        pairId,
      )
      .toArray()[0];
    return row
      ? {
          pairId: row.pair_id,
          secretHash: row.secret_hash,
          label: row.label,
          createdAt: row.created_at,
          generation: row.generation,
        }
      : null;
  }

  /** Looks a pair up by its pairing code. Failed lookups are rate limited relay-wide. */
  findByCode(code: string): { pairId: string; label: string; generation: string } | 'not-found' | 'throttled' {
    if (this.count('code-failures', CODE_WINDOW_MS) >= MAX_CODE_FAILURES) return 'throttled';
    const row = this.sql
      .exec<{ pair_id: string; label: string; generation: string }>(
        'SELECT pair_id, label, generation FROM pairs WHERE code = ?',
        code,
      )
      .toArray()[0];
    if (row) return { pairId: row.pair_id, label: row.label, generation: row.generation };
    this.bump('code-failures', CODE_WINDOW_MS, Number.POSITIVE_INFINITY);
    return 'not-found';
  }

  /** Deletes the pair and leaves a tombstone so the pairId can't be registered again. */
  remove(pairId: string): boolean {
    const removed = this.sql.exec('DELETE FROM pairs WHERE pair_id = ?', pairId).rowsWritten > 0;
    this.sql.exec('INSERT OR IGNORE INTO tombstones (pair_id, removed_at) VALUES (?, ?)', pairId, Date.now());
    return removed;
  }

  private count(key: string, windowMs: number): number {
    const bucket = Math.floor(Date.now() / windowMs);
    const row = this.sql
      .exec<{ bucket: number; count: number }>('SELECT bucket, count FROM counters WHERE key = ?', key)
      .toArray()[0];
    return row && row.bucket === bucket ? row.count : 0;
  }

  /** Increments a fixed-window counter; returns false (without incrementing) once `max` is reached. */
  private bump(key: string, windowMs: number, max: number): boolean {
    const bucket = Math.floor(Date.now() / windowMs);
    const current = this.count(key, windowMs);
    if (current >= max) return false;
    this.sql.exec(
      'INSERT INTO counters (key, bucket, count) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET bucket = excluded.bucket, count = excluded.count',
      key,
      bucket,
      current + 1,
    );
    return true;
  }
}
