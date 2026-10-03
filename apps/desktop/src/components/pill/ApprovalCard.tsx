/**
 * Approval Card (brief §6, security-model R2):
 *  - every risk: Allow once · Deny; Esc = Deny.
 *  - low/medium: "Always allow in this project" + voice hint ("Say yes to allow").
 *  - high: click only — no always-allow, no voice hint ("Click to confirm"), Deny focused by default.
 */
import { AlertTriangle, FileWarning, Globe, Plug, ShieldAlert, SquareTerminal, Trash2 } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { type MessageKey, useT } from '../../i18n';
import { cn } from '../../lib/cn';
import type { ApprovalDecision, ApprovalKind, ApprovalRequest } from '../../types/ui';
import { AgentMark } from '../common/common';
import { Button } from '../ui/button';
import { Badge } from '../ui/primitives';

const KIND_ICON: Record<ApprovalKind, typeof SquareTerminal> = {
  shell: SquareTerminal,
  'file-write': FileWarning,
  'file-delete': Trash2,
  network: Globe,
  'mcp-tool': Plug,
};

export interface ApprovalCardProps {
  request: ApprovalRequest;
  onDecision?(id: string, decision: ApprovalDecision): void;
  /** Injectable clock for the optional countdown (tests). */
  now?: () => number;
}

export function useCountdown(expiresAt: number | undefined, now: () => number = Date.now): number | null {
  const [left, setLeft] = useState(() => (expiresAt ? Math.max(0, expiresAt - now()) : null));
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setLeft(Math.max(0, expiresAt - now())), 1000);
    return () => clearInterval(id);
  }, [expiresAt, now]);
  return left;
}

export function ApprovalCard({ request, onDecision, now }: ApprovalCardProps) {
  const t = useT();
  const high = request.risk === 'high';
  const rootRef = useRef<HTMLDivElement>(null);
  const denyRef = useRef<HTMLButtonElement>(null);
  const left = useCountdown(request.expiresAt, now);
  const Icon = KIND_ICON[request.kind];

  // Move focus into the alert dialog; for high risk the safe choice (Deny) is focused.
  useEffect(() => {
    if (high) denyRef.current?.focus();
    else rootRef.current?.focus();
  }, [high]);

  const decide = (d: ApprovalDecision) => onDecision?.(request.id, d);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      decide('deny');
    }
  };

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
      className={cn(
        'flex w-full flex-col gap-3 rounded-lg border bg-surface-raised p-4 outline-none',
        high ? 'border-danger/60' : 'border-ember/50',
      )}
    >
      <div className="flex items-start gap-3">
        <span className={cn('mt-0.5', high ? 'text-danger' : 'text-ember')}>
          <Icon size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={`appr-title-${request.id}`} className="text-base font-semibold">
              {request.title}
            </h2>
            <Badge tone={high ? 'danger' : request.risk === 'medium' ? 'warning' : 'neutral'}>
              {high ? <ShieldAlert size={12} aria-hidden="true" /> : <AlertTriangle size={12} aria-hidden="true" />}
              {t(`approval.risk.${request.risk}` as MessageKey)}
            </Badge>
          </div>
          <pre
            id={`appr-detail-${request.id}`}
            data-selectable
            className="mt-2 max-h-24 overflow-auto rounded-sm bg-surface-sunken px-2 py-1.5 font-mono text-sm whitespace-pre-wrap break-all text-accent"
          >
            {request.detail}
          </pre>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
            <span className="inline-flex items-center gap-1">
              <AgentMark id={request.agent} size={10} className="bg-transparent" />
              {t(`agent.${request.agent}` as MessageKey)}
            </span>
            {request.project ? <span>{t('approval.project', { project: request.project })}</span> : null}
            {request.cwd ? <span className="font-mono">{request.cwd}</span> : null}
            {left !== null ? (
              <span aria-live="off">{t('approval.expires', { s: Math.ceil(left / 1000) })}</span>
            ) : null}
          </div>
          {request.reason ? <p className="mt-2 text-sm text-muted">{request.reason}</p> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant={high ? 'danger' : 'primary'} size="md" onClick={() => decide('allow-once')}>
          {t('approval.allowOnce')}
        </Button>
        <Button ref={denyRef} variant="secondary" size="md" onClick={() => decide('deny')}>
          {t('approval.deny')}
        </Button>
        {high ? null : (
          <Button variant="ghost" size="md" onClick={() => decide('always-allow-project')}>
            {t('approval.alwaysAllow')}
          </Button>
        )}
        <span className="ms-auto text-xs text-subtle" data-testid="approval-hint">
          {high ? t('approval.hint.click') : t('approval.hint.voice')}
        </span>
      </div>
    </div>
  );
}
