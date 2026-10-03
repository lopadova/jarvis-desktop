/**
 * Approval Card (brief §6, handoff `ApprovalCard.dc.html`, security-model R2):
 *  - every risk: Allow once · Deny; Esc = Deny.
 *  - low/medium: "Always allow in this project" + voice hint ("Say yes to allow").
 *  - high: click only — no always-allow, no voice hint ("Click to confirm"), Deny focused by default.
 */
import {
  FilePen,
  FileX,
  Globe,
  type LucideIcon,
  MessageSquareQuote,
  Mic,
  MousePointerClick,
  Plug,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  TriangleAlert,
} from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { type MessageKey, useT } from '../../i18n';
import type { ApprovalDecision, ApprovalKind, ApprovalRequest, RiskLevel } from '../../types/ui';
import { AgentMark } from '../common/common';

const KIND_ICON: Record<ApprovalKind, LucideIcon> = {
  shell: Terminal,
  'file-write': FilePen,
  'file-delete': FileX,
  network: Globe,
  'mcp-tool': Plug,
};
const RISK_ICON: Record<RiskLevel, LucideIcon> = { low: ShieldCheck, medium: ShieldAlert, high: TriangleAlert };
const PROMPT: Record<ApprovalKind, string> = {
  shell: '$',
  'file-write': '✎',
  'file-delete': '✕',
  network: '→',
  'mcp-tool': '⚙',
};

export const riskColor = (risk: RiskLevel) =>
  risk === 'high' ? 'var(--color-danger)' : risk === 'medium' ? 'var(--color-warning)' : 'var(--color-success)';

export interface ApprovalCardProps {
  request: ApprovalRequest;
  onDecision?(id: string, decision: ApprovalDecision): void;
  /** Injectable clock for the optional countdown (tests). */
  now?: () => number;
  /** Inside the Listening Pill: no own card chrome. */
  embedded?: boolean;
  /** Move focus into the card on mount (default true). */
  autoFocus?: boolean;
}

export function useCountdown(expiresAt: number | undefined, now: () => number = Date.now): number | null {
  const [left, setLeft] = useState(() => (expiresAt ? Math.max(0, expiresAt - now()) : null));
  useEffect(() => {
    if (!expiresAt) return;
    setLeft(Math.max(0, expiresAt - now()));
    const id = setInterval(() => setLeft(Math.max(0, expiresAt - now())), 1000);
    return () => clearInterval(id);
  }, [expiresAt, now]);
  return left;
}

/** Shell-ish syntax tint: program in accent, flags in ember, paths muted. */
function tokens(detail: string, kind: ApprovalKind) {
  return detail.split(' ').map((w, i) => ({
    w,
    color:
      i === 0 && kind === 'shell'
        ? 'var(--color-accent)'
        : w.startsWith('-')
          ? 'var(--color-ember)'
          : /[/.~]/.test(w)
            ? 'var(--color-text-muted)'
            : 'var(--color-text)',
    bold: i === 0 && kind === 'shell',
  }));
}

export function ApprovalCard({ request, onDecision, now, embedded, autoFocus = true }: ApprovalCardProps) {
  const t = useT();
  const high = request.risk === 'high';
  const rootRef = useRef<HTMLDivElement>(null);
  const denyRef = useRef<HTMLButtonElement>(null);
  const left = useCountdown(request.expiresAt, now);
  const KindIcon = KIND_ICON[request.kind] ?? Terminal;
  const RiskIcon = RISK_ICON[request.risk];
  const rc = riskColor(request.risk);

  // Move focus into the alert dialog; for high risk the safe choice (Deny) is focused.
  useEffect(() => {
    if (!autoFocus) return;
    if (high) denyRef.current?.focus({ preventScroll: true });
    else rootRef.current?.focus({ preventScroll: true });
  }, [high, autoFocus]);

  const decide = (d: ApprovalDecision) => onDecision?.(request.id, d);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      decide('deny');
    }
  };
  const secs = left === null ? 0 : Math.ceil(left / 1000);

  return (
    <div
      ref={rootRef}
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={`appr-title-${request.id}`}
      aria-describedby={`appr-detail-${request.id}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-risk={request.risk}
      className={
        embedded
          ? 'flex flex-col gap-[14px] font-sans outline-none'
          : 'flex max-w-[560px] flex-col gap-[14px] rounded-[16px] border bg-surface-raised p-[18px] font-sans shadow-md outline-none'
      }
      style={embedded ? undefined : { borderColor: high ? 'var(--color-danger)' : 'var(--color-border)' }}
    >
      <div className="flex items-start gap-3">
        <div
          className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px]"
          style={{ background: `color-mix(in oklab, ${rc} 16%, transparent)`, color: rc }}
        >
          <KindIcon size={18} aria-hidden="true" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={`appr-title-${request.id}`} className="m-0 text-[15px] font-semibold tracking-[-0.01em] text-text">
              {request.title}
            </h2>
            <span
              className="inline-flex h-5 items-center gap-1 rounded-pill px-2 text-[11px] font-semibold"
              style={{
                color: rc,
                background: `color-mix(in oklab, ${rc} 14%, transparent)`,
                border: `1px solid color-mix(in oklab, ${rc} 35%, transparent)`,
              }}
            >
              <RiskIcon size={12} aria-hidden="true" />
              {t(`approval.risk.${request.risk}` as MessageKey)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
            <AgentMark id={request.agent} size={18} radius={5} fontSize={9} />
            <span>{t(`agent.${request.agent}` as MessageKey)}</span>
            {request.project ? (
              <>
                <span className="text-subtle">·</span>
                <span>
                  {t('approval.in')} <b className="font-semibold text-text">{request.project}</b>
                </span>
              </>
            ) : null}
          </div>
        </div>
        {left !== null ? (
          <div
            className="relative h-[34px] w-[34px] shrink-0"
            title={t('approval.expires', { s: secs })}
            role="timer"
            aria-live="off"
            aria-label={t('approval.expires', { s: secs })}
          >
            <svg width="34" height="34" viewBox="0 0 34 34" className="-rotate-90" aria-hidden="true">
              <circle cx="17" cy="17" r="14" fill="none" stroke="var(--color-border-strong)" strokeWidth="2.5" />
              <circle
                cx="17"
                cy="17"
                r="14"
                fill="none"
                stroke="var(--color-warning)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray="88"
                strokeDashoffset={88 - 88 * Math.min(1, (left ?? 0) / 60000)}
              />
            </svg>
            <span className="tabular absolute inset-0 grid place-items-center text-[10.5px] font-semibold text-muted">
              {secs}s
            </span>
          </div>
        ) : null}
      </div>

      <div
        id={`appr-detail-${request.id}`}
        className="flex flex-col gap-1.5 rounded-[10px] border border-border bg-surface-sunken px-[14px] py-3"
      >
        <code
          data-selectable
          data-testid="approval-detail"
          className="flex flex-wrap font-mono text-[13px] leading-[1.55] break-all text-text"
          style={{ columnGap: '0.6ch' }}
        >
          <span className="text-subtle select-none" aria-hidden="true">
            {PROMPT[request.kind] ?? '$'}
          </span>
          <span className="sr-only">{request.detail}</span>
          {tokens(request.detail, request.kind).map((tk, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: words of a fixed string; order never changes.
            <span key={i} aria-hidden="true" style={{ color: tk.color, fontWeight: tk.bold ? 600 : 400 }}>
              {tk.w}
            </span>
          ))}
        </code>
        {request.cwd ? (
          <span className="font-mono text-[11.5px] text-subtle">
            {t('approval.in')} {request.cwd}
          </span>
        ) : null}
      </div>

      {request.reason ? (
        <div className="flex gap-2 text-[13px] leading-[1.5] text-muted">
          <MessageSquareQuote size={14} aria-hidden="true" className="mt-[3px] shrink-0 text-subtle" />
          <span className="text-pretty">{request.reason}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <span
          className="flex min-w-[160px] flex-1 items-center gap-1.5 text-[12px] text-subtle"
          data-testid="approval-hint"
        >
          {high ? (
            <MousePointerClick size={13} aria-hidden="true" className="shrink-0" />
          ) : (
            <Mic size={13} aria-hidden="true" className="shrink-0" />
          )}
          {high ? t('approval.hint.click') : t('approval.hint.voice')}
        </span>
        <button
          ref={denyRef}
          type="button"
          onClick={() => decide('deny')}
          className="h-9 cursor-pointer rounded-[10px] border border-border-strong bg-surface-raised px-[14px] text-[13px] font-semibold text-text hover:bg-surface-sunken"
        >
          {t('approval.deny')}
        </button>
        {high ? null : (
          <button
            type="button"
            onClick={() => decide('always-allow-project')}
            className="h-9 cursor-pointer rounded-[10px] border-0 bg-transparent px-3 text-[13px] font-medium text-muted hover:bg-surface-raised hover:text-text"
          >
            {t('approval.alwaysAllow')}
          </button>
        )}
        <button
          type="button"
          onClick={() => decide('allow-once')}
          className={
            high
              ? 'h-9 cursor-pointer rounded-[10px] border-0 bg-danger px-4 text-[13px] font-semibold text-inverse'
              : 'h-9 cursor-pointer rounded-[10px] border-0 bg-accent px-4 text-[13px] font-semibold text-accent-contrast'
          }
        >
          {t('approval.allowOnce')}
        </button>
      </div>
    </div>
  );
}
