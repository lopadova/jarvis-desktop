import { randomBytes, timingSafeEqual } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

/** Short random id: prefix + 12 base36-ish chars. */
export function newId(prefix = ''): string {
  return `${prefix}${randomBytes(9).toString('base64url').replace(/[-_]/g, 'x')}`;
}

/** Exactly 16 ASCII hex chars (used as the binary-frame utterance id). */
export const newUtteranceId = (): string => randomBytes(8).toString('hex');

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('hex');

/** Constant-time string comparison (length leak only). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length || ab.length === 0) {
    // Still burn a comparison so timing does not depend on where strings differ.
    timingSafeEqual(bb, bb);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return resolve(homedir(), p.slice(2));
  return p;
}

/** Lexical containment only: callers making security decisions must use `isInsideReal`. */
function isInsideLexical(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Resolves symlinks for a path that may not exist yet: realpath of the deepest existing ancestor,
 * with the non-existent tail re-joined.
 */
export function realPathLoose(p: string): string {
  let current = resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = realpathSync.native(current);
      return tail.length ? join(real, ...tail.reverse()) : real;
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(p);
      tail.push(basename(current));
      current = parent;
    }
  }
}

/**
 * True when `child` is `parent` or inside it, after resolving symlinks on both sides (a link inside
 * the project that points elsewhere is NOT inside). Used for every insideProject / allowed-root check.
 */
export function isInside(parent: string, child: string): boolean {
  return isInsideLexical(realPathLoose(parent), realPathLoose(child));
}

export function slug(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'project'
  );
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Removes keys whose value is undefined (for exactOptional-friendly object literals). */
export function compact<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}
