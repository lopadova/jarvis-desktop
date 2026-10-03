/**
 * Pill state holder. Approval and clarify states are "sticky": transient states (thinking, speaking,
 * listening) do not hide a pending approval card; when the transient state ends the sticky one returns.
 */
import type { PillEvent, PillState } from '@jarvis/core';
import type { UiSink } from './host.js';

export class Pill {
  private transient: PillState = { kind: 'hidden' };
  private sticky: PillState | null = null;

  constructor(
    private readonly ui: UiSink,
    private readonly privateMode: () => boolean,
  ) {}

  get state(): PillState {
    if (this.sticky && (this.transient.kind === 'hidden' || this.transient.kind === 'idle-hint')) return this.sticky;
    if (this.sticky?.kind === 'approval' && this.transient.kind !== 'listening') return this.sticky;
    return this.transient;
  }

  set(state: PillState): void {
    this.transient = state;
    this.publish();
  }

  setSticky(state: PillState | null): void {
    this.sticky = state;
    this.publish();
  }

  get stickyKind(): PillState['kind'] | null {
    return this.sticky?.kind ?? null;
  }

  clearSticky(kind?: PillState['kind']): void {
    if (!this.sticky) return;
    if (kind && this.sticky.kind !== kind) return;
    this.sticky = null;
    this.publish();
  }

  publish(): void {
    const ev: PillEvent = { state: this.state, privateMode: this.privateMode() };
    this.ui.emit('ui.pill', ev);
  }
}
