/** S2 — Sessions Panel (handoff `SessionsPanel.dc.html`): running first, then most recent; compact; empty. */
import { ChevronDown, ChevronUp, Rows3, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import type { Locale, SessionCardProps, SessionView } from '../../types/ui';
import { Orb } from '../orb/Orb';
import { SessionCard, type SessionCardExtraProps } from './SessionCard';

const LIVE = new Set(['running', 'needs-input', 'approval']);

export function sortSessions(sessions: SessionView[]): SessionView[] {
  return [...sessions].sort((a, b) => {
    const la = LIVE.has(a.status) ? 1 : 0;
    const lb = LIVE.has(b.status) ? 1 : 0;
    if (la !== lb) return lb - la;
    return b.startedAt - a.startedAt;
  });
}

export interface SessionsPanelProps extends Omit<SessionCardProps, 'session'>, Omit<SessionCardExtraProps, 'compact'> {
  sessions: SessionView[];
  locale: Locale;
  maxHeight?: number | string;
  onClearFinished?(): void;
  onClose?(): void;
}

const iconBtn =
  'grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-[7px] border-0 text-muted hover:bg-surface-raised hover:text-text';

export function SessionsPanel({
  sessions,
  locale,
  maxHeight = '70vh',
  onClearFinished,
  onClose,
  ...handlers
}: SessionsPanelProps) {
  const t = useT();
  const [compact, setCompact] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const sorted = useMemo(() => sortSessions(sessions), [sessions]);
  const visible = compact ? sorted.filter((s) => LIVE.has(s.status)) : sorted;
  const finished = sessions.some((s) => !LIVE.has(s.status));
  const running = sessions.filter((s) => LIVE.has(s.status)).length;

  return (
    <section
      aria-label={t('sessions.title')}
      className="glass flex w-[380px] max-w-full flex-col overflow-hidden rounded-[18px] border border-border bg-surface font-sans text-text shadow-lg"
      style={{ maxHeight }}
    >
      <header data-tauri-drag-region className="flex h-12 shrink-0 cursor-grab items-center gap-2 py-0 pr-2 pl-4">
        <h1 data-tauri-drag-region className="m-0 text-[14px] font-semibold tracking-[-0.01em]">
          {t('sessions.title')}
        </h1>
        <span
          title={t('sessions.running', { n: running })}
          className="tabular grid h-5 min-w-5 place-items-center rounded-pill bg-accent-soft px-1.5 text-[11.5px] font-semibold text-text"
        >
          <span aria-hidden="true">{running}</span>
          <span className="sr-only">{t('sessions.running', { n: running })}</span>
        </span>
        <span data-tauri-drag-region className="flex-1 self-stretch" />
        {finished && onClearFinished ? (
          <button
            type="button"
            onClick={onClearFinished}
            className="h-7 cursor-pointer rounded-[7px] border-0 bg-transparent px-2 text-[12px] font-medium text-muted hover:bg-surface-raised hover:text-text"
          >
            {t('sessions.clearFinished')}
          </button>
        ) : null}
        <button
          type="button"
          aria-pressed={compact}
          aria-label={t('sessions.compact')}
          title={t('sessions.compact')}
          onClick={() => setCompact((c) => !c)}
          className={iconBtn}
          style={{ background: compact ? 'var(--color-accent-soft)' : 'transparent' }}
        >
          <Rows3 size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={t('sessions.collapse')}
          title={t('sessions.collapse')}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
          className={`${iconBtn} bg-transparent`}
        >
          {collapsed ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronUp size={15} aria-hidden="true" />}
        </button>
        {onClose ? (
          <button
            type="button"
            aria-label={t('window.close')}
            title={t('window.close')}
            onClick={onClose}
            className={`${iconBtn} bg-transparent`}
          >
            <X size={15} aria-hidden="true" />
          </button>
        ) : null}
      </header>
      {collapsed ? null : (
        <>
          {visible.length === 0 ? (
            <div className="flex flex-col items-center gap-[14px] px-8 pt-7 pb-9 text-center">
              <Orb size={56} state="muted" animated={false} />
              <span className="text-[14px] font-semibold">{t('sessions.empty.title')}</span>
              <span className="text-pretty text-[13px] leading-[1.5] text-muted">
                {t('sessions.empty.try')} <em className="text-text">{t('sessions.empty.example')}</em>
              </span>
            </div>
          ) : null}
          <div
            aria-live="polite"
            className="scroll-y flex min-h-0 flex-col overflow-x-hidden px-2.5 pb-2.5"
            style={{ gap: compact ? 6 : 8 }}
          >
            {visible.map((s) => (
              <SessionCard key={s.id} session={s} locale={locale} compact={compact} {...handlers} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
