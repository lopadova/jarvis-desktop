/** Picks the backend: the real sidecar inside Tauri, or the in-browser mock (`?mock=1` / plain browser). */
import type { Locale } from '../types/ui';
import { isTauri, sidecarEndpoint } from '../lib/tauri';
import { RpcClient, type Transport } from './client';
import { MockTransport } from './mock';

export function isMockMode(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  return new URLSearchParams(search).get('mock') === '1' || !isTauri();
}

export function createTransport(locale: Locale = 'en'): Transport {
  if (isMockMode()) return new MockTransport(locale);
  return new RpcClient({ endpoint: sidecarEndpoint });
}
