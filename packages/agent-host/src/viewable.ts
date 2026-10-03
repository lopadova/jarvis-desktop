/**
 * Viewable results: what Jarvis may open on screen automatically when a session finishes.
 * - http(s) URLs only on localhost / 127.0.0.1 / [::1] (0.0.0.0 is rewritten to localhost);
 * - local files only when absolute after resolution and inside the session folder (symlinks resolved);
 * - UNC paths, `file://` URLs with a host and any other scheme are rejected.
 * Anything else is never opened automatically (the UI may show it as a plain link).
 */
import { isAbsolute, resolve } from 'node:path';
import { isInside } from './util.js';

export type Openable = { target: string; kind: 'url' | 'path' };

const LOCAL_URL = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{2,5})?(?:\/[^\s)'"\]<>`]*)?/i;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Returns the target if Jarvis may open it automatically for a session working in `cwd`. */
export function safeOpenable(candidate: string | undefined, cwd: string): Openable | undefined {
  if (!candidate) return undefined;
  const c = candidate.trim();
  if (/^https?:\/\//i.test(c)) {
    try {
      const u = new URL(c.replace(/\/\/0\.0\.0\.0/, '//localhost'));
      if (u.username || u.password) return undefined;
      return LOCAL_HOSTS.has(u.hostname.toLowerCase()) ? { target: u.href, kind: 'url' } : undefined;
    } catch {
      return undefined;
    }
  }
  let p = c;
  if (/^file:/i.test(p)) {
    try {
      const u = new URL(p);
      if (u.host && u.host !== 'localhost') return undefined;
      p = decodeURIComponent(u.pathname.replace(/^\/([a-z]:)/i, '$1'));
    } catch {
      return undefined;
    }
  }
  if (/^(\\\\|\/\/)/.test(p)) return undefined; // UNC / network paths
  if (/^[a-z][a-z0-9+.-]+:/i.test(p) && !/^[a-z]:[\\/]/i.test(p)) return undefined; // other schemes
  const abs = resolve(cwd, p);
  if (!isAbsolute(abs) || !isInside(cwd, abs)) return undefined;
  return { target: abs, kind: 'path' };
}

/** Finds a viewable result: a localhost URL in the result text, else an .html file the agent wrote. */
export function detectViewable(text: string, htmlPath: string | undefined, cwd: string): string | undefined {
  const m = text.match(LOCAL_URL);
  if (m) {
    const url = safeOpenable(m[0].replace(/[.,;:]+$/, ''), cwd);
    if (url) return url.target;
  }
  return safeOpenable(htmlPath, cwd)?.target;
}
