/** ChatBubble + SystemCard (brief §6). */
import {
  AlarmClock,
  CalendarDays,
  Check,
  CircleAlert,
  ExternalLink,
  Mail,
  Mic,
  Play,
  Rocket,
  Sun,
  Timer,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { type MessageKey, useLocale, useT } from '../../i18n';
import { cn } from '../../lib/cn';
import type { ChatMessage, SystemCardData } from '../../types/ui';
import { AgentMark } from '../common/common';
import { Orb } from '../orb/Orb';
import { Button } from '../ui/button';

const time = (at: number, locale: string) =>
  new Date(at).toLocaleTimeString(locale === 'it' ? 'it-IT' : 'en-GB', { hour: '2-digit', minute: '2-digit' });

export interface ChatBubbleProps {
  message: ChatMessage;
  onReplay?(id: string): void;
  onOpenSession?(id: string): void;
  onReviewApproval?(id: string): void;
}

export function ChatBubble({ message, onReplay, onOpenSession, onReviewApproval }: ChatBubbleProps) {
  const t = useT();
  const locale = useLocale();
  if (message.role === 'system')
    return <SystemCard card={message.card} onOpenSession={onOpenSession} onReviewApproval={onReviewApproval} />;
  const user = message.role === 'user';
  return (
    <div className={cn('flex items-end gap-2', user ? 'justify-end' : 'justify-start')}>
      {user ? null : <Orb size={24} state="idle" animated={false} />}
      <div
        data-selectable
        className={cn(
          'max-w-[80%] rounded-lg px-3 py-2 text-sm',
          user ? 'rounded-br-xs bg-accent text-accent-contrast' : 'rounded-bl-xs border border-border bg-surface',
        )}
      >
        <p className="whitespace-pre-wrap">{message.text}</p>
        <div className={cn('mt-1 flex items-center gap-2 text-xs', user ? 'opacity-80' : 'text-subtle')}>
          <time dateTime={new Date(message.at).toISOString()}>{time(message.at, locale)}</time>
          {message.role === 'user' && message.viaVoice ? (
            <span className="inline-flex items-center gap-0.5">
              <Mic size={10} aria-hidden="true" />
              {t('chat.viaVoice')}
            </span>
          ) : null}
          {message.role === 'jarvis' && message.spoken ? (
            <>
              <span>{t('chat.spoken')}</span>
              {onReplay ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 hover:text-text"
                  onClick={() => onReplay(message.id)}
                  aria-label={t('chat.replay')}
                >
                  <Play size={10} aria-hidden="true" />
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function SystemCard({
  card,
  onOpenSession,
  onReviewApproval,
}: {
  card: SystemCardData;
  onOpenSession?(id: string): void;
  onReviewApproval?(id: string): void;
}) {
  const t = useT();
  const locale = useLocale();
  const shell = (icon: ReactNode, title: string, body?: ReactNode, action?: ReactNode) => (
    <div className="mx-auto flex w-full max-w-[560px] items-start gap-3 rounded-lg border border-border bg-surface-sunken p-3">
      <span className="mt-0.5 text-accent">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        {body ? <div className="mt-0.5 text-xs text-muted">{body}</div> : null}
      </div>
      {action}
    </div>
  );
  switch (card.type) {
    case 'session-started':
      return shell(
        <Rocket size={16} aria-hidden="true" />,
        t('card.sessionStarted'),
        <span className="inline-flex items-center gap-1">
          <AgentMark id={card.session.agent} size={10} className="bg-transparent" />
          {card.session.task} · {card.session.project}
        </span>,
      );
    case 'approval-needed':
      return shell(
        <CircleAlert size={16} aria-hidden="true" className="text-ember" />,
        t('card.approvalNeeded'),
        <span className="font-mono">{card.request.detail}</span>,
        onReviewApproval ? (
          <Button size="sm" onClick={() => onReviewApproval(card.request.id)}>
            {t('card.review')}
          </Button>
        ) : null,
      );
    case 'result-ready':
      return shell(
        <Check size={16} aria-hidden="true" className="text-success" />,
        t('card.resultReady'),
        card.session.resultPreview ?? card.session.task,
        onOpenSession ? (
          <Button size="sm" onClick={() => onOpenSession(card.session.id)}>
            <ExternalLink size={12} aria-hidden="true" />
            {t('session.open')}
          </Button>
        ) : null,
      );
    case 'reminder-set':
      return shell(
        <AlarmClock size={16} aria-hidden="true" />,
        t('card.reminderSet'),
        `${card.text} · ${time(card.dueAt, locale)}`,
      );
    case 'timer':
      return shell(
        <Timer size={16} aria-hidden="true" />,
        card.label,
        t('card.timerEnds', { time: time(card.endsAt, locale) }),
      );
    case 'briefing':
      return (
        <div className="mx-auto w-full max-w-[560px] rounded-lg border border-border bg-surface-sunken p-3 text-sm">
          <div className="mb-2 font-medium">{t('card.briefing')}</div>
          {card.weather ? (
            <p className="flex items-center gap-2 text-muted">
              <Sun size={14} aria-hidden="true" />
              {card.weather}
            </p>
          ) : null}
          <ul className="mt-2 space-y-1">
            {card.events.map((e) => (
              <li key={`${e.time}-${e.title}`} className="flex items-center gap-2">
                <CalendarDays size={12} aria-hidden="true" className="text-subtle" />
                <span className="font-mono text-xs">{e.time}</span> {e.title}
              </li>
            ))}
            {card.emails.map((m) => (
              <li key={`${m.from}-${m.subject}`} className="flex items-center gap-2">
                <Mail size={12} aria-hidden="true" className="text-subtle" />
                <span className="text-xs text-muted">{m.from}</span> {m.subject}
              </li>
            ))}
          </ul>
        </div>
      );
    default:
      return <div className="text-xs text-subtle">{t(`card.unknown` as MessageKey)}</div>;
  }
}
