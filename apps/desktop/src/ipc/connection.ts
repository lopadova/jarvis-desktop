/** Picks the backend: the real sidecar inside Tauri, or the in-browser mock (`?mock=1` / plain browser). */

import { isTauri, sidecarEndpoint } from '../lib/tauri';
import { previewPatch } from '../mocks/preview';
import type { Locale } from '../types/ui';
import { RpcClient, type Transport } from './client';
import { MockTransport } from './mock';

export function isMockMode(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  return new URLSearchParams(search).get('mock') === '1' || !isTauri();
}

export function createTransport(locale: Locale = 'en'): Transport {
  if (isMockMode()) {
    const q = typeof location === 'undefined' ? null : new URLSearchParams(location.search);
    const mock = new MockTransport(q?.get('locale') === 'it' ? 'it' : locale);
    if (typeof location !== 'undefined') mock.patch(previewPatch(mock.snapshot, location.search));
    return mock;
  }
  return new RpcClient({ endpoint: sidecarEndpoint });
}
