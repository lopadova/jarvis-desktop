/** Durable memories (user-visible, editable; forget by id only — R12). */
import { addMemory, agentGuidanceFromMemories, forgetMemory, type Memory } from '@jarvis/core';
import type { Store } from './store/store.js';
import { newId } from './util.js';

export class MemoryService {
  constructor(
    private readonly store: Store,
    private readonly now: () => number = Date.now,
  ) {}

  list(): Memory[] {
    return this.store.listMemories();
  }

  add(text: string): Memory | null {
    const before = this.list();
    const next = addMemory(before, text, () => newId('m_'), this.now());
    if (next === before) return null;
    this.store.replaceMemories(next);
    return next.at(-1) ?? null;
  }

  forget(id: string): Memory | undefined {
    const { list, removed } = forgetMemory(this.list(), id);
    if (removed) this.store.replaceMemories(list);
    return removed;
  }

  clear(): void {
    this.store.replaceMemories([]);
  }

  guidance(): string {
    return agentGuidanceFromMemories(this.list()) ?? '';
  }
}
