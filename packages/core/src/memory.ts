import type { Memory } from './model.js';

export const MAX_MEMORIES = 200;

const canon = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Adds a memory, replacing exact (normalised) duplicates; keeps at most MAX_MEMORIES (oldest dropped). */
export function addMemory(list: Memory[], text: string, makeId: () => string, now = Date.now()): Memory[] {
  const clean = text.trim();
  if (!clean) return list;
  const key = canon(clean);
  const next = list.filter((m) => canon(m.text) !== key);
  next.push({ id: makeId(), text: clean, createdAt: now, source: 'said' });
  return next.length > MAX_MEMORIES ? next.slice(next.length - MAX_MEMORIES) : next;
}

/** Forget by id only (security-model R12). Returns the removed memory, if any. */
export function forgetMemory(list: Memory[], id: string): { list: Memory[]; removed?: Memory } {
  const removed = list.find((m) => m.id === id);
  return { list: removed ? list.filter((m) => m.id !== id) : list, removed };
}

/** Guidance appended to agent sessions so they honour standing preferences. */
export function agentGuidanceFromMemories(list: Memory[]): string | null {
  if (!list.length) return null;
  return `Standing preferences the user asked the assistant to remember (apply those relevant to this task):\n${list.map((m) => `- ${m.text}`).join('\n')}`;
}
