/**
 * Thin synchronous SQLite adapter: `bun:sqlite` in the compiled binary, `node:sqlite` (DatabaseSync)
 * under Node (tests, dev). Both expose prepare/run/all/get with positional `?` parameters.
 */

export type SqlValue = string | number | bigint | null | Uint8Array;

export interface SqlDb {
  exec(sql: string): void;
  run(sql: string, ...params: SqlValue[]): { changes: number };
  all<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T[];
  get<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T | undefined;
  transaction(fn: () => void): void;
  close(): void;
}

export const isBun = (): boolean => typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

interface Stmt {
  run(...p: SqlValue[]): { changes: number | bigint };
  all(...p: SqlValue[]): unknown[];
  get(...p: SqlValue[]): unknown;
}
interface RawDb {
  exec(sql: string): void;
  prepare(sql: string): Stmt;
  close(): void;
}

class Adapter implements SqlDb {
  private readonly cache = new Map<string, Stmt>();
  private depth = 0;
  constructor(private readonly db: RawDb) {}
  private stmt(sql: string): Stmt {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }
  exec(sql: string): void {
    this.db.exec(sql);
  }
  run(sql: string, ...params: SqlValue[]): { changes: number } {
    const r = this.stmt(sql).run(...params);
    return { changes: Number(r.changes) };
  }
  all<T>(sql: string, ...params: SqlValue[]): T[] {
    return this.stmt(sql).all(...params) as T[];
  }
  get<T>(sql: string, ...params: SqlValue[]): T | undefined {
    return (this.stmt(sql).get(...params) ?? undefined) as T | undefined;
  }
  transaction(fn: () => void): void {
    if (this.depth > 0) {
      fn();
      return;
    }
    this.depth++;
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    } finally {
      this.depth--;
    }
  }
  close(): void {
    this.cache.clear();
    this.db.close();
  }
}

/** Opens (or creates) a database file; `:memory:` for tests. */
export async function openDatabase(path: string): Promise<SqlDb> {
  // Specifiers are computed so bundlers/vite never try to resolve the other runtime's module.
  const spec = isBun() ? 'bun:sqlite' : 'node:sqlite';
  if (isBun()) {
    const mod = (await import(spec)) as { Database: new (p: string, o?: { create?: boolean }) => RawDb };
    const db = new mod.Database(path, { create: true });
    return withPragmas(new Adapter(db));
  }
  const mod = (await import(spec)) as { DatabaseSync: new (p: string) => RawDb };
  return withPragmas(new Adapter(new mod.DatabaseSync(path)));
}

function withPragmas(db: SqlDb): SqlDb {
  db.exec(
    'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;',
  );
  return db;
}
