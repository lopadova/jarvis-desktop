/** Session Card (handoff `SessionCard.dc.html`): full card or one-line compact row. */
import {
  ArrowUp,
  CircleCheck,
  CircleSlash,
  CircleX,
  ExternalLink,
  LoaderCircle,
  type LucideIcon,
  MessageCircleQuestionMark,
  ScrollText,
  ShieldAlert,
  Square,
  X,
} from 'lucide-react';
import { type CSSProperties, useState } from 'react';
import { type MessageKey, translate } from '../../i18n';
import { useMotion, useNow } from '../../lib/motion';
import type { SessionCardProps, SessionStatus } from '../../types/ui';
import { AgentMark } from '../common/common';

export const STATUS_COLOR: Record<SessionStatus, string> = {
  running: 'var(--color-accent)',
  'needs-input': 'var(--color-ember)',
  approval: 'var(--color-warning)',
  done: 'var(--color-success)',
  failed: 'var(--color-danger)',
  cancelled: 'var(--color-text-subtle)',
};
const STATUS_ICON: Record<SessionStatus, LucideIcon> = {
  running: LoaderCircle,
  'needs-input': MessageCircleQuestionMark,
  approval: ShieldAlert,
  done: CircleCheck,
  failed: CircleX,
  cancelled: CircleSlash,
};

const LIVE: SessionStatus[] = ['running', 'needs-input', 'approval'];

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export interface SessionCardExtraProps {
  compact?: boolean;
  /** "Review" on a session waiting for approval (shows the approval card). */
  onReview?(id: string): void;
}

interface Action {
  key: string;
  label: string;
  icon: LucideIcon;
  primary?: boolean;
  on(): void;
}

export function SessionCard({
  session: s,
  locale,
  onOpen,
  onLog,
  onReply,
  onStop,
  onDismiss,
  onReview,
  compact,
}: SessionCardProps & SessionCardExtraProps) {
  const t = (k: MessageKey, v?: Record<string, string | number>) => translate(locale, k, v);
  const active = LIVE.includes(s.status);
  const now = useNow(active);
  const anim = useMotion();
  const [reply, setReply] = useState('');
  const c = STATUS_COLOR[s.status];
  const StatusIcon = STATUS_ICON[s.status];
  const elapsed = formatElapsed((s.finishedAt ?? now) - s.startedAt);
  const agentName = t(`agent.${s.agent}` as MessageKey);
  const statusLabel = t(`session.status.${s.status}` as MessageKey);
  const pulse: CSSProperties = {
    background: c,
    animation: s.status === 'running' && anim ? 'jv-pulse 1.6s ease-in-out infinite' : 'none',
  };

  if (compact)
    return (
      <div
        data-status={s.status}
        className="flex h-10 items-center gap-2.5 rounded-[10px] border border-border bg-surface-raised px-3 font-sans"
      >
        <AgentMark id={s.agent} size={22} radius={6} fontSize={9.5} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">{s.task}</span>
        <span className="h-2 w-2 shrink-0 rounded-pill" style={pulse} />
        <span className="sr-only">{statusLabel}</span>
        <span className="tabular text-[12px] text-subtle">{elapsed}</span>
      </div>
    );

  const A: Record<'open' | 'review' | 'log' | 'stop', Action> = {
    open: { key: 'open', label: t('session.open'), icon: ExternalLink, primary: true, on: () => onOpen?.(s.id) },
    review: { key: 'review', label: t('session.review'), icon: ShieldAlert, primary: true, on: () => onReview?.(s.id) },
    log: { key: 'log', label: t('session.log'), icon: ScrollText, on: () => onLog?.(s.id) },
    stop: { key: 'stop', label: t('session.stop'), icon: Square, on: () => onStop?.(s.id) },
  };
  const actions =
    s.status === 'done'
      ? [A.open, A.log]
      : s.status === 'approval'
        ? [A.review, A.log, A.stop]
        : active
          ? [A.log, A.stop]
          : [A.log];
  const send = () => {
    const text = reply.trim();
    if (!text) return;
    onReply?.(s.id, text);
    setReply('');
  };

  return (
    <article
      aria-label={`${agentName}: ${s.task} — ${statusLabel}`}
      data-status={s.status}
      className="flex flex-col gap-2.5 rounded-[14px] border bg-surface-raised p-[14px] font-sans transition-[border-color] duration-200"
      style={{
        borderColor:
          s.status === 'approval'
            ? 'color-mix(in oklab, var(--color-warning) 55%, transparent)'
            : 'var(--color-border)',
      }}
    >
      <div className="flex items-start gap-3">
        <AgentMark id={s.agent} size={30} radius={8} fontSize={11.5} />
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="text-pretty line-clamp-2 text-[14px] leading-[1.35] font-semibold text-text">{s.task}</span>
          <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-subtle">
            <span>{agentName}</span>
            <span aria-hidden="true">·</span>
            <span>{s.project}</span>
            <span aria-hidden="true">·</span>
            <span role="timer" aria-live="off" className="tabular" aria-label={t('session.elapsed', { t: elapsed })}>
              {elapsed}
            </span>
          </span>
        </div>
        <span
          className="inline-flex h-[22px] shrink-0 items-center gap-[5px] rounded-pill px-2 text-[11.5px] font-semibold whitespace-nowrap transition-[color,background] duration-200"
          style={{ color: c, background: `color-mix(in oklab, ${c} 14%, transparent)` }}
        >
          <StatusIcon
            key={s.status}
            size={12}
            aria-hidden="true"
            style={{
              animation: anim
                ? s.status === 'running'
                  ? 'jv-spin 1.2s linear infinite'
                  : s.status === 'done'
                    ? 'jv-pop .5s cubic-bezier(.3,1.5,.5,1) 1'
                    : 'none'
                : 'none',
            }}
          />
          {statusLabel}
        </span>
      </div>

      {s.activity && active ? (
        <div className="flex min-w-0 items-center gap-2 text-[12.5px] text-muted" aria-live="polite">
          <span className="h-1.5 w-1.5 shrink-0 rounded-pill" style={pulse} />
          <span className="truncate">{s.activity}</span>
        </div>
      ) : null}

      {s.resultPreview && !active ? (
        <p className="text-pretty m-0 line-clamp-2 text-[12.5px] leading-[1.5] text-muted" data-selectable>
          {s.resultPreview}
        </p>
      ) : null}

      {s.status === 'needs-input' ? (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={t('session.replyPlaceholder')}
            aria-label={t('session.reply')}
            maxLength={4000}
            className="h-8 min-w-0 flex-1 rounded-[8px] border border-border-strong bg-surface-sunken px-2.5 font-sans text-[13px] text-text outline-none focus:border-accent"
          />
          <button
            type="submit"
            aria-label={t('session.reply')}
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-[8px] border-0 bg-accent text-accent-contrast"
          >
            <ArrowUp size={15} aria-hidden="true" />
          </button>
        </form>
      ) : null}

      <div className="-mx-1.5 -mb-1 flex items-center gap-1">
        {actions.map((a) => {
          const I = a.icon;
          return (
            <button
              key={a.key}
              type="button"
              onClick={a.on}
              className={
                a.primary
                  ? 'inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[7px] border-0 bg-accent-soft px-2 text-[12.5px] font-semibold whitespace-nowrap text-text hover:bg-surface-sunken'
                  : 'inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[7px] border-0 bg-transparent px-2 text-[12.5px] font-medium whitespace-nowrap text-muted hover:bg-surface-sunken hover:text-text'
              }
            >
              <I size={13} aria-hidden="true" />
              {a.label}
            </button>
          );
        })}
        <span className="flex-1" />
        {!active && onDismiss ? (
          <button
            type="button"
            onClick={() => onDismiss(s.id)}
            aria-label={t('session.dismiss')}
            className="grid h-7 w-7 cursor-pointer place-items-center rounded-[7px] border-0 bg-transparent text-subtle hover:bg-surface-sunken hover:text-text"
          >
            <X size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </article>
  );
}
