/** Pair records in Redis: `pair:<id>`, `paircode:<CODE>` index and `tombstone:<id>` after unpairing. */
import { type PairRegistration, pairingCodeFromHash } from './shared/pairing.js';
import type { Store } from './store.js';

export interface PairRecord {
  secretHash: string;
  label: string;
  createdAt: number;
  /** Per-registration nonce that OAuth grants are bound to. */
  generation: string;
}

export async function loadPair(store: Store, pairId: string): Promise<PairRecord | null> {
  const raw = await store.get(`pair:${pairId}`);
  return raw ? (JSON.parse(raw) as PairRecord) : null;
}

export async function registerPair(store: Store, reg: PairRegistration): Promise<'created' | 'conflict'> {
  if (await store.get(`tombstone:${reg.pairId}`)) return 'conflict';
  const record: PairRecord = {
    secretHash: reg.secretHash,
    label: reg.label,
    createdAt: Date.now(),
    generation: crypto.randomUUID(),
  };
  if (!(await store.set(`pair:${reg.pairId}`, JSON.stringify(record), { nx: true }))) return 'conflict';
  const code = pairingCodeFromHash(reg.secretHash);
  if (!(await store.set(`paircode:${code}`, reg.pairId, { nx: true }))) {
    await store.del(`pair:${reg.pairId}`);
    return 'conflict';
  }
  return 'created';
}

/** Unpairs: removes the record and its code and leaves a permanent tombstone. Existing OAuth tokens
 *  stop working immediately because every request re-checks the pair's generation. */
export async function removePair(store: Store, pairId: string, record: PairRecord): Promise<void> {
  await store.set(`tombstone:${pairId}`, String(Date.now()));
  await store.del(
    `pair:${pairId}`,
    `paircode:${pairingCodeFromHash(record.secretHash)}`,
    `hello:${pairId}`,
    `seen:${pairId}`,
    `queue:${pairId}`,
  );
}
