/**
 * Tiny key-value/queue abstraction over Upstash Redis (REST, free tier). An in-memory version is
 * used by the tests. Values are plain strings; callers JSON-encode.
 */
import { Redis } from '@upstash/redis';

export interface Store {
  get(key: string): Promise<string | null>;
  /** `nx`: only set when absent (returns false if the key already existed). `ex`: TTL in seconds. */
  set(key: string, value: string, options?: { ex?: number; nx?: boolean }): Promise<boolean>;
  del(...keys: string[]): Promise<void>;
  /** Atomically reads and deletes (single-use codes). */
  getdel(key: string): Promise<string | null>;
  lpush(key: string, value: string, ttlSeconds: number): Promise<void>;
  rpop(key: string): Promise<string | null>;
  /** INCR + EXPIRE (on first increment); returns the new value. */
  incr(key: string, ttlSeconds: number): Promise<number>;
}

export function upstashStore(env: Record<string, string | undefined>): Store {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error('Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or connect Upstash in Vercel).');
  }
  const redis = new Redis({ url, token, automaticDeserialization: false });
  return {
    get: (key) => redis.get<string>(key),
    async set(key, value, options = {}) {
      const opts = options.nx
        ? options.ex
          ? { nx: true as const, ex: options.ex }
          : { nx: true as const }
        : options.ex
          ? { ex: options.ex }
          : undefined;
      const result = await redis.set(key, value, opts);
      return result === 'OK';
    },
    async del(...keys) {
      if (keys.length) await redis.del(...keys);
    },
    getdel: (key) => redis.getdel<string>(key),
    async lpush(key, value, ttlSeconds) {
      const pipeline = redis.pipeline();
      pipeline.lpush(key, value);
      pipeline.expire(key, ttlSeconds);
      await pipeline.exec();
    },
    rpop: (key) => redis.rpop<string>(key),
    async incr(key, ttlSeconds) {
      const value = await redis.incr(key);
      if (value === 1) await redis.expire(key, ttlSeconds);
      return value;
    },
  };
}

/** In-memory store with TTLs (tests and local experiments only). */
export function memoryStore(now: () => number = Date.now): Store {
  const values = new Map<string, { value: string; expires: number }>();
  const lists = new Map<string, { items: string[]; expires: number }>();
  const alive = (expires: number) => expires === 0 || expires > now();
  const ttl = (seconds?: number) => (seconds ? now() + seconds * 1000 : 0);
  const read = (key: string) => {
    const entry = values.get(key);
    if (entry && !alive(entry.expires)) values.delete(key);
    return entry && alive(entry.expires) ? entry.value : null;
  };
  return {
    get: async (key) => read(key),
    async set(key, value, options = {}) {
      if (options.nx && read(key) !== null) return false;
      values.set(key, { value, expires: ttl(options.ex) });
      return true;
    },
    async del(...keys) {
      for (const key of keys) {
        values.delete(key);
        lists.delete(key);
      }
    },
    async getdel(key) {
      const value = read(key);
      values.delete(key);
      return value;
    },
    async lpush(key, value, ttlSeconds) {
      const list = lists.get(key);
      const items = list && alive(list.expires) ? list.items : [];
      items.unshift(value);
      lists.set(key, { items, expires: ttl(ttlSeconds) });
    },
    async rpop(key) {
      const list = lists.get(key);
      if (!list || !alive(list.expires)) return null;
      return list.items.pop() ?? null;
    },
    async incr(key, ttlSeconds) {
      const next = Number(read(key) ?? 0) + 1;
      const existing = values.get(key);
      values.set(key, { value: String(next), expires: existing && next > 1 ? existing.expires : ttl(ttlSeconds) });
      return next;
    },
  };
}
