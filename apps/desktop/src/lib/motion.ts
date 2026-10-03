/**
 * Motion gate: animations run only when the user allows motion and the document is visible
 * (brief §3/§8). CSS animations are additionally paused by `html[data-hidden]` in globals.css.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';

const REDUCE = '(prefers-reduced-motion: reduce)';

function subscribeReduce(cb: () => void): () => void {
  const m = typeof window !== 'undefined' ? window.matchMedia?.(REDUCE) : undefined;
  m?.addEventListener?.('change', cb);
  return () => m?.removeEventListener?.('change', cb);
}

const reduceSnapshot = () => (typeof window !== 'undefined' ? (window.matchMedia?.(REDUCE).matches ?? false) : false);

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduce, reduceSnapshot, () => false);
}

function subscribeVisibility(cb: () => void): () => void {
  document.addEventListener('visibilitychange', cb);
  return () => document.removeEventListener('visibilitychange', cb);
}

export function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => !document.hidden,
    () => true,
  );
}

/** True when decorative motion may run. */
export function useMotion(): boolean {
  const reduce = usePrefersReducedMotion();
  const visible = useDocumentVisible();
  return !reduce && visible;
}

/** A ticking clock (ms) that stops while the document is hidden or when disabled. */
export function useNow(enabled = true, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  const visible = useDocumentVisible();
  useEffect(() => {
    if (!enabled || !visible) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [enabled, visible, intervalMs]);
  return now;
}
