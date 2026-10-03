/** S2 — Sessions Panel: running first, then most recent; compact mode; empty state. */
import { ChevronsDownUp, ChevronsUpDown, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import type { Locale, SessionCardProps, SessionView } from '../../types/ui';
import { EmptyState } from '../common/common';
import { Button } from '../ui/button';
import { Badge } from '../ui/primitives';
import { SessionCard } from './SessionCard';

const LIVE = new Set(['running', 'needs-input', 'approval']);

export function sortSessions(sessions: SessionView[]): SessionView[] {
  return [...sessions].sort((a, b) => {
    const la = LIVE.has(a.status) ? 1 : 0;
    const lb = LIVE.has(b.status) ? 1 : 0;
    if (la !== lb) return lb - la;
    return (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt);
  });
}

export interface SessionsPanelProps extends Omit<SessionCardProps, 'session'> {
  sessions: SessionView[];
  locale: Locale;
  onClearFinished?(): void;
  onClose?(): void;
}

export function SessionsPanel({ sessions, locale, onClearFinished, onClose, ...handlers }: SessionsPanelProps) {
  const t = useT();
  const [compact, setCompact] = useState(false);
  const sorted = useMemo(() => sortSessions(sessions), [sessions]);
  const visible = compact ? sorted.filter((s) => LIVE.has(s.status)) : sorted;
  const finished = sessions.some((s) => !LIVE.has(s.status));

  return (
    <section
      aria-label={t('sessions.title')}
      className="flex max-h-[70vh] w-[380px] max-w-full flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-lg"
    >
      <header data-tauri-drag-region className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h1 data-tauri-drag-region className="text-sm font-semibold">
          {t('sessions.title')}
        </h1>
        <Badge>{sessions.length}</Badge>
        <div data-tauri-drag-region className="flex-1" />
        {finished && onClearFinished ? (
          <Button variant="ghost" size="sm" onClick={onClearFinished}>
            {t('sessions.clearFinished')}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          aria-pressed={compact}
          aria-label={t('sessions.compact')}
          onClick={() => setCompact((c) => !c)}
        >
          {compact ? <ChevronsUpDown size={14} aria-hidden="true" /> : <ChevronsDownUp size={14} aria-hidden="true" />}
        </Button>
        {onClose ? (
          <Button variant="ghost" size="icon" aria-label={t('window.close')} onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </Button>
        ) : null}
      </header>
      <div className="scroll-y flex flex-col gap-2 p-3">
        {visible.length === 0 ? (
          <EmptyState title={t('sessions.empty.title')} hint={t('sessions.empty.hint')} />
        ) : (
          visible.map((s) => <SessionCard key={s.id} session={s} locale={locale} compact={compact} {...handlers} />)
        )}
      </div>
    </section>
  );
}
