import { Ban, Check, CircleAlert, CircleDot, ExternalLink, Hand, ScrollText, Send, Square, X, XCircle } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { type MessageKey, translate } from '../../i18n';
import { cn } from '../../lib/cn';
import type { SessionCardProps, SessionStatus } from '../../types/ui';
import { AgentMark } from '../common/common';
import { Button } from '../ui/button';
import { Input } from '../ui/primitives';

const STATUS: Record<SessionStatus, { icon: typeof Check; tone: string }> = {
  running: { icon: CircleDot, tone: 'text-accent' },
  'needs-input': { icon: Hand, tone: 'text-ember' },
  approval: { icon: CircleAlert, tone: 'text-ember' },
  done: { icon: Check, tone: 'text-success' },
  failed: { icon: XCircle, tone: 'text-danger' },
  cancelled: { icon: Ban, tone: 'text-subtle' },
};

const LIVE: SessionStatus[] = ['running', 'needs-input', 'approval'];

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

export function SessionCard({ session, locale, onOpen, onLog, onReply, onStop, onDismiss, compact }: SessionCardProps & { compact?: boolean }) {
  const t = (k: MessageKey, v?: Record<string, string | number>) => translate(locale, k, v);
  const live = LIVE.includes(session.status);
  const now = useNow(live);
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const { icon: StatusIcon, tone } = STATUS[session.status];
  const elapsed = formatElapsed((session.finishedAt ?? now) - session.startedAt);

  const submitReply = (e: FormEvent) => {
    e.preventDefault();
    const text = reply.trim();
    if (!text) return;
    onReply?.(session.id, text);
    setReply('');
    setReplying(false);
  };

  return (
    <article
      aria-label={session.task}
      data-status={session.status}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 transition-colors duration-200"
    >
      <div className="flex items-center gap-2">
        <AgentMark id={session.agent} size={12} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{session.task}</div>
          <div className="flex items-center gap-1.5 text-xs text-subtle">
            <span className={cn('inline-flex items-center gap-1', tone)}>
              <StatusIcon size={12} aria-hidden="true" />
              {t(`session.status.${session.status}` as MessageKey)}
            </span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{session.project}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums" aria-label={t('session.elapsed', { t: elapsed })}>
              {elapsed}
            </span>
          </div>
        </div>
        {!live && onDismiss ? (
          <Button variant="ghost" size="icon" aria-label={t('session.dismiss')} onClick={() => onDismiss(session.id)}>
            <X size={14} aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      {!compact && live && session.activity ? (
        <div className="truncate text-xs text-muted" aria-live="polite">
          {session.activity}
        </div>
      ) : null}
      {!compact && session.resultPreview ? (
        <p className="line-clamp-2 text-xs text-muted" data-selectable>
          {session.resultPreview}
        </p>
      ) : null}

      {!compact ? (
        <div className="flex flex-wrap gap-1">
          {session.resultUrl || session.status === 'done' ? (
            <Button size="sm" variant="secondary" onClick={() => onOpen?.(session.id)}>
              <ExternalLink size={12} aria-hidden="true" />
              {t('session.open')}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => onLog?.(session.id)}>
            <ScrollText size={12} aria-hidden="true" />
            {t('session.log')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setReplying((v) => !v)} aria-expanded={replying}>
            <Send size={12} aria-hidden="true" />
            {t('session.reply')}
          </Button>
          {live ? (
            <Button size="sm" variant="ghost" className="text-danger" onClick={() => onStop?.(session.id)}>
              <Square size={12} aria-hidden="true" />
              {t('session.stop')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {replying ? (
        <form onSubmit={submitReply} className="flex gap-2">
          <Input
            autoFocus
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={t('session.replyPlaceholder')}
            aria-label={t('session.reply')}
            maxLength={4000}
          />
          <Button type="submit" size="sm" variant="primary" disabled={!reply.trim()}>
            {t('session.send')}
          </Button>
        </form>
      ) : null}
    </article>
  );
}
