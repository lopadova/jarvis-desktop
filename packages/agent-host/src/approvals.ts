/**
 * Approval broker (security-model R1/R2, ADR 0003).
 * - Every request gets an id and an expiry (default 90 s); expiry denies and says so.
 * - Voice yes/no is accepted ONLY for low/medium risk; high risk needs a click (or keyboard) in the UI.
 * - "Always allow in this project" is refused for high risk and persisted as a per-project rule.
 * - Every request and decision is written to the audit log.
 */
import {
  type AgentId,
  type ApprovalDecision,
  type ApprovalKind,
  type ApprovalRequest,
  alwaysAllowOffered,
  type Logger,
  parseYesNo,
  phrases,
  type RiskLevel,
  type Settings,
  voiceApprovalAllowed,
} from '@jarvis/core';
import type { UiSink } from './host.js';
import type { Pill } from './pill.js';
import type { Store } from './store/store.js';
import { newId } from './util.js';

export type ApprovalVia = 'click' | 'voice' | 'keyboard' | 'timeout' | 'rule' | 'cancel' | 'too-long';

export interface ApprovalInput {
  sessionId: string;
  agent: AgentId;
  projectId: string | null;
  project?: string;
  kind: ApprovalKind;
  risk: RiskLevel;
  title: string;
  detail: string;
  cwd?: string;
  reason?: string;
}

export interface ApprovalDeps {
  store: Store;
  ui: UiSink;
  pill: Pill;
  speak: (text: string) => void;
  settings: () => Settings;
  logger: Logger;
  timeoutMs?: number;
  now?: () => number;
  /** Called when a session enters/leaves the approval state. */
  onPendingChange?: (sessionId: string, pending: boolean) => void;
}

interface PendingApproval {
  req: ApprovalRequest;
  projectId: string | null;
  resolve: (d: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

export type DecideResult = { ok: true } | { ok: false; reason: string };

export const ruleKey = (projectId: string | null): string => projectId ?? 'general';

/** Longest detail a user can be expected to review; longer requests are denied, never truncated. */
export const MAX_REVIEWABLE_DETAIL = 2000;

// Zero-width, bidi controls, soft hyphen, BOM, and C0/C1 controls (tab/newline/CR are allowed).
const INVISIBLE_SRC =
  '[\\u00AD\\u061C\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]';

export const hasInvisible = (s: string): boolean => new RegExp(INVISIBLE_SRC).test(s);

/** Makes invisible/bidi/control characters visible as \u{XXXX} so the user sees exactly what runs. */
export function escapeInvisible(s: string): string {
  return s.replace(
    new RegExp(INVISIBLE_SRC, 'g'),
    (ch) => `\\u{${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}}`,
  );
}

export class ApprovalBroker {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly now: () => number;

  constructor(private readonly deps: ApprovalDeps) {
    this.now = deps.now ?? Date.now;
  }

  list(): ApprovalRequest[] {
    return [...this.pending.values()].map((p) => p.req);
  }

  hasPending(): boolean {
    return this.pending.size > 0;
  }

  request(input: ApprovalInput): Promise<ApprovalDecision> {
    const { store, logger } = this.deps;
    const at = this.now();
    const id = newId('ap_');
    // Hidden characters can make a command look different from what runs: always high risk, shown escaped.
    if (hasInvisible(input.detail) || hasInvisible(input.title)) input = { ...input, risk: 'high' };
    const detail = escapeInvisible(input.detail);
    const title = escapeInvisible(input.title);
    const tooLong = detail.length > MAX_REVIEWABLE_DETAIL;
    store.auditApprovalRequest({
      id,
      sessionId: input.sessionId,
      agent: input.agent,
      project: input.project,
      kind: input.kind,
      risk: input.risk,
      title,
      detail: tooLong ? `${detail.slice(0, MAX_REVIEWABLE_DETAIL)}…[${detail.length} chars]` : detail,
      createdAt: at,
    });

    if (tooLong) {
      store.auditApprovalDecision(id, 'deny', 'too-long', at);
      logger.warn('approval auto-denied: detail too long to review', { id, length: detail.length });
      this.deps.ui.emit('ui.toast', {
        level: 'warning',
        title: 'Request denied',
        body: `An agent asked to ${title.slice(0, 80)} with a command too long to review safely (${detail.length} characters), so I denied it.`,
      });
      return Promise.resolve('deny');
    }

    if (input.risk !== 'high' && store.hasApprovalRule(ruleKey(input.projectId), input.kind, input.detail)) {
      store.auditApprovalDecision(id, 'allow-once', 'rule', at);
      logger.info('approval auto-allowed by project rule', { id, kind: input.kind });
      return Promise.resolve('allow-once');
    }

    const timeoutMs = this.deps.timeoutMs ?? 90_000;
    const req: ApprovalRequest = {
      id,
      sessionId: input.sessionId,
      kind: input.kind,
      risk: input.risk,
      title,
      detail,
      agent: input.agent,
      expiresAt: at + timeoutMs,
    };
    if (input.cwd) req.cwd = input.cwd;
    if (input.project) req.project = input.project;
    if (input.reason) req.reason = input.reason.slice(0, 500);

    return new Promise<ApprovalDecision>((resolve) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.finish(id, 'deny', 'timeout');
        this.deps.speak(phrases(this.deps.settings().locale).approvalExpired);
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { req, projectId: input.projectId, resolve, timer });
      this.deps.onPendingChange?.(input.sessionId, true);
      this.deps.ui.emit('ui.approval', { state: 'pending', request: req, pending: this.list() });
      this.showNext();
      const p = phrases(this.deps.settings().locale);
      this.deps.speak(voiceApprovalAllowed(req.risk) ? p.approvalVoice(req.title) : p.approvalClick(req.title));
    });
  }

  decide(id: string, decision: ApprovalDecision, via: ApprovalVia): DecideResult {
    const p = this.pending.get(id);
    if (!p) return { ok: false, reason: 'unknown or expired approval' };
    if (via === 'voice' && !voiceApprovalAllowed(p.req.risk) && decision !== 'deny') {
      return { ok: false, reason: 'high-risk requests need a click' };
    }
    if (decision === 'always-allow-project' && !alwaysAllowOffered(p.req.risk)) {
      return { ok: false, reason: '"always allow" is not available for high-risk requests' };
    }
    if (decision === 'always-allow-project') {
      this.deps.store.addApprovalRule(ruleKey(p.projectId), p.req.kind, p.req.detail, this.now());
    }
    this.finish(id, decision, via);
    if (decision === 'deny' && via !== 'cancel') this.deps.speak(phrases(this.deps.settings().locale).approvalDenied);
    return { ok: true };
  }

  /**
   * Voice answer for the most recent pending approval. Returns true when the utterance was consumed.
   * High risk: a spoken "yes" is NOT accepted (R2) — Jarvis asks for a click instead.
   */
  handleUtterance(text: string): boolean {
    const last = [...this.pending.values()].at(-1);
    if (!last) return false;
    const yn = parseYesNo(text);
    if (!yn) return false;
    if (yn === 'no') {
      this.decide(last.req.id, 'deny', 'voice');
      return true;
    }
    if (!voiceApprovalAllowed(last.req.risk)) {
      this.deps.logger.warn('voice approval refused for high-risk request', { id: last.req.id });
      this.deps.speak(phrases(this.deps.settings().locale).approvalClick(last.req.title));
      return true;
    }
    this.decide(last.req.id, 'allow-once', 'voice');
    return true;
  }

  /** Denies every pending request of a session (stop/cancel). */
  cancelSession(sessionId: string): void {
    for (const [id, p] of this.pending) if (p.req.sessionId === sessionId) this.finish(id, 'deny', 'cancel');
  }

  cancelAll(): void {
    for (const id of [...this.pending.keys()]) this.finish(id, 'deny', 'cancel');
  }

  private finish(id: string, decision: ApprovalDecision, via: ApprovalVia): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    this.deps.store.auditApprovalDecision(id, decision, via, this.now());
    this.deps.logger.info('approval decided', { id, decision, via, risk: p.req.risk });
    this.deps.ui.emit('ui.approval', { state: 'resolved', id, decision, via, pending: this.list() });
    if (![...this.pending.values()].some((o) => o.req.sessionId === p.req.sessionId)) {
      this.deps.onPendingChange?.(p.req.sessionId, false);
    }
    this.showNext();
    p.resolve(decision);
  }

  private showNext(): void {
    const next = [...this.pending.values()].at(-1);
    if (next) this.deps.pill.setSticky({ kind: 'approval', request: next.req });
    else this.deps.pill.clearSticky('approval');
  }
}
