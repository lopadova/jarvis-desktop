/** ChatBubble + SystemCard (brief §6, handoff `ChatMessage.dc.html`). */
import type { ShoppingItem } from '@jarvis/core';
import {
  Bell,
  Check,
  CircleAlert,
  CircleCheck,
  CircleX,
  Copy,
  ExternalLink,
  FileText,
  type LucideIcon,
  Mic,
  PanelRight,
  Play,
  RotateCcw,
  ShieldAlert,
  ShoppingCart,
  Sunrise,
  Timer,
  Volume2,
  X,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { type MessageKey, useLocale, useT } from '../../i18n';
import { useNow } from '../../lib/motion';
import type { ApprovalDecision, ChatMessage, SystemCardData } from '../../types/ui';
import { Orb } from '../orb/Orb';

export const formatTime = (at: number, locale: string) =>
  new Date(at).toLocaleTimeString(locale === 'it' ? 'it-IT' : 'en-GB', { hour: '2-digit', minute: '2-digit' });

export interface ChatBubbleProps {
  message: ChatMessage;
  onReplay?(id: string): void;
  onOpenSession?(id: string): void;
  onViewSession?(id: string): void;
  onApproval?(id: string, decision: ApprovalDecision): void;
  /** Decision already taken for an approval card (from the store). */
  resolved?: ApprovalDecision;
  /** False when the approval is no longer pending (expired/resolved elsewhere). */
  pending?: boolean;
  /** Copy a text result back to the clipboard (text-result cards). */
  onCopy?(text: string): void;
  /** Live shopping list: given only to the newest shopping card, which then offers remove buttons. */
  shoppingLive?: ShoppingItem[];
  onShoppingRemove?(id: string): void;
}

export function ChatBubble({
  message: m,
  onReplay,
  onOpenSession,
  onViewSession,
  onApproval,
  resolved,
  pending,
  onCopy,
  shoppingLive,
  onShoppingRemove,
}: ChatBubbleProps) {
  const t = useT();
  const locale = useLocale();
  if (m.role === 'system')
    return (
      <SystemCard
        card={m.card}
        onOpenSession={onOpenSession}
        onViewSession={onViewSession}
        onApproval={onApproval}
        resolved={resolved}
        pending={pending}
        onCopy={onCopy}
        shoppingLive={shoppingLive}
        onShoppingRemove={onShoppingRemove}
      />
    );
  const time = <time dateTime={new Date(m.at).toISOString()}>{formatTime(m.at, locale)}</time>;
  if (m.role === 'user')
    return (
      <div className="flex flex-col items-end gap-1 font-sans">
        <div
          data-selectable
          className="text-pretty max-w-[78%] rounded-[16px_16px_4px_16px] border bg-accent-soft px-[14px] py-2.5 text-[14px] leading-[1.5] whitespace-pre-wrap text-text"
          style={{ borderColor: 'color-mix(in oklab, var(--color-accent) 25%, transparent)' }}
        >
          {m.text}
        </div>
        <span className="flex items-center gap-[5px] text-[11.5px] text-subtle">
          {m.viaVoice ? (
            <>
              <Mic size={11} aria-hidden="true" />
              {t('chat.said')} ·
            </>
          ) : null}
          {time}
        </span>
      </div>
    );
  const error = 'error' in m && Boolean((m as { error?: boolean }).error);
  return (
    <div className="flex items-start gap-2.5 font-sans">
      <Orb size={24} state={error ? 'error' : 'idle'} animated={false} />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <div
          data-selectable
          className="text-pretty max-w-[86%] rounded-[4px_16px_16px_16px] border bg-surface-raised px-[14px] py-2.5 text-[14px] leading-[1.55] whitespace-pre-wrap text-text"
          style={{
            borderColor: error ? 'color-mix(in oklab, var(--color-danger) 50%, transparent)' : 'var(--color-border)',
          }}
        >
          {m.text}
        </div>
        <span className="flex items-center gap-1.5 text-[11.5px] text-subtle">
          {m.spoken ? (
            <>
              <span className="inline-flex items-center gap-1">
                <Volume2 size={12} aria-hidden="true" />
                {t('chat.spoken')}
              </span>
              {onReplay ? (
                <button
                  type="button"
                  onClick={() => onReplay(m.id)}
                  aria-label={t('chat.replay')}
                  className="inline-flex h-[22px] cursor-pointer items-center gap-1 rounded-[6px] border-0 bg-transparent px-1.5 text-[11.5px] font-medium text-muted hover:bg-surface-raised hover:text-text"
                >
                  <RotateCcw size={11} aria-hidden="true" />
                  {t('chat.replay')}
                </button>
              ) : null}
              ·
            </>
          ) : null}
          {error ? (
            <>
              <span className="inline-flex items-center gap-1 text-danger">
                <CircleAlert size={12} aria-hidden="true" />
                {t('chat.failed')}
              </span>
              ·
            </>
          ) : null}
          {time}
        </span>
      </div>
    </div>
  );
}

const CARD_META: Record<SystemCardData['type'], { icon: LucideIcon; color: string }> = {
  'session-started': { icon: Play, color: 'var(--color-accent)' },
  'approval-needed': { icon: ShieldAlert, color: 'var(--color-warning)' },
  'result-ready': { icon: CircleCheck, color: 'var(--color-success)' },
  'reminder-set': { icon: Bell, color: 'var(--color-ember)' },
  timer: { icon: Timer, color: 'var(--color-accent)' },
  briefing: { icon: Sunrise, color: 'var(--color-ember)' },
  shopping: { icon: ShoppingCart, color: 'var(--color-success)' },
  'text-result': { icon: FileText, color: 'var(--color-accent)' },
};

const smallPrimary =
  'inline-flex h-[30px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[8px] border-0 bg-accent px-3 text-[12.5px] font-semibold text-accent-contrast';

export function SystemCard({
  card: c,
  onOpenSession,
  onViewSession,
  onApproval,
  resolved,
  pending = true,
  onCopy,
  shoppingLive,
  onShoppingRemove,
}: {
  card: SystemCardData;
  onOpenSession?(id: string): void;
  onViewSession?(id: string): void;
  onApproval?(id: string, decision: ApprovalDecision): void;
  resolved?: ApprovalDecision;
  pending?: boolean;
  onCopy?(text: string): void;
  shoppingLive?: ShoppingItem[];
  onShoppingRemove?(id: string): void;
}) {
  const t = useT();
  const locale = useLocale();
  const now = useNow(c.type === 'timer');
  const [copied, setCopied] = useState(false);
  const meta = CARD_META[c.type];
  if (!meta) return <div className="pl-[34px] text-[12px] text-subtle">{t('card.unknown')}</div>;
  const { icon: I, color } = meta;

  let title = '';
  let sub = '';
  let body = '';
  let big = '';
  let button: ReactNode = null;
  let extra: ReactNode = null;
  let timerPct = 0;
  const agentName = (id: string) => t(`agent.${id}` as MessageKey);

  switch (c.type) {
    case 'session-started':
      title = t('card.started', { agent: agentName(c.session.agent) });
      sub = `${c.session.project} · ${c.session.task}`;
      button = (
        <button type="button" className={smallPrimary} onClick={() => onViewSession?.(c.session.id)}>
          <PanelRight size={13} aria-hidden="true" />
          {t('card.view')}
        </button>
      );
      break;
    case 'result-ready':
      title = t('card.resultReady');
      sub = `${c.session.project} · ${c.session.task}`;
      body = c.session.resultPreview ?? '';
      button = onOpenSession ? (
        <button type="button" className={smallPrimary} onClick={() => onOpenSession(c.session.id)}>
          <ExternalLink size={13} aria-hidden="true" />
          {t('card.open')}
        </button>
      ) : null;
      break;
    case 'approval-needed': {
      title = t('card.approvalNeeded');
      sub = `${agentName(c.request.agent)} · ${c.request.title}`;
      const open = !resolved && pending;
      extra = (
        <>
          <code
            data-selectable
            className="rounded-[8px] bg-surface-sunken px-2.5 py-2 font-mono text-[12.5px] break-all text-text"
          >
            {c.request.detail}
          </code>
          {open && onApproval ? (
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => onApproval(c.request.id, 'allow-once')}
                className={
                  c.request.risk === 'high'
                    ? 'h-[30px] cursor-pointer rounded-[8px] border-0 bg-danger px-3 text-[12.5px] font-semibold text-inverse'
                    : 'h-[30px] cursor-pointer rounded-[8px] border-0 bg-accent px-3 text-[12.5px] font-semibold text-accent-contrast'
                }
              >
                {t('approval.allowOnce')}
              </button>
              <button
                type="button"
                onClick={() => onApproval(c.request.id, 'deny')}
                className="h-[30px] cursor-pointer rounded-[8px] border border-border-strong bg-surface-raised px-3 text-[12.5px] font-semibold text-text"
              >
                {t('approval.deny')}
              </button>
            </div>
          ) : null}
          {resolved || !pending ? (
            <span className="flex items-center gap-[5px] text-[12px] text-muted">
              {resolved === 'deny' ? (
                <CircleX size={13} aria-hidden="true" />
              ) : (
                <CircleCheck size={13} aria-hidden="true" />
              )}
              {resolved === 'deny'
                ? t('card.denied')
                : resolved === 'always-allow-project'
                  ? t('card.alwaysAllowed')
                  : resolved
                    ? t('card.allowed')
                    : t('card.resolved')}
            </span>
          ) : null}
        </>
      );
      break;
    }
    case 'reminder-set':
      title = t('card.reminderSet');
      sub = c.text;
      big = formatTime(c.dueAt, locale);
      break;
    case 'timer': {
      const total = 'total' in c && typeof c.total === 'number' ? c.total : 600_000;
      const left = Math.max(0, c.endsAt - now);
      title = c.label;
      sub = left ? '' : t('card.timerDone');
      big = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
      timerPct = 100 * (1 - left / total);
      break;
    }
    case 'shopping': {
      const items = shoppingLive ?? c.items;
      const added = new Set(c.added ?? []);
      title = t('card.shopping');
      sub = c.added?.length
        ? t('card.shopping.added', { items: c.added.join(', ') })
        : c.removed?.length
          ? t('card.shopping.removed', { items: c.removed.join(', ') })
          : t('card.shopping.count', { n: items.length });
      extra = items.length ? (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {items.map((i) => (
            <li key={i.id} className="flex min-h-[28px] items-center gap-2.5 text-[13px] text-text">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-pill"
                style={{ background: added.has(i.text) ? 'var(--color-success)' : 'var(--color-border-strong)' }}
              />
              <span className="min-w-0 flex-1 truncate">{i.text}</span>
              {shoppingLive && onShoppingRemove ? (
                <button
                  type="button"
                  onClick={() => onShoppingRemove(i.id)}
                  aria-label={t('card.shopping.remove', { item: i.text })}
                  title={t('card.shopping.remove', { item: i.text })}
                  className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-[6px] border-0 bg-transparent text-muted hover:bg-surface-sunken hover:text-text"
                >
                  <X size={13} aria-hidden="true" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-[12.5px] text-subtle">{t('card.shopping.empty')}</span>
      );
      break;
    }
    case 'text-result':
      title = c.source === 'clipboard' ? t('card.textResult.clipboard') : t('card.textResult.screen');
      sub = t('card.textResult.private');
      button = onCopy ? (
        <button
          type="button"
          className={smallPrimary}
          onClick={() => {
            onCopy(c.text);
            setCopied(true);
          }}
        >
          {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          {copied ? t('card.copied') : t('card.copy')}
        </button>
      ) : null;
      extra = (
        <p
          data-selectable
          className="text-pretty scroll-y m-0 max-h-[280px] text-[13.5px] leading-[1.55] whitespace-pre-wrap text-text"
        >
          {c.text}
        </p>
      );
      break;
    case 'briefing':
      title = t('card.briefing');
      sub = c.weather ?? '';
      extra = (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4 pt-0.5">
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold tracking-[.06em] text-subtle uppercase">
              {t('card.calendar')}
            </span>
            {c.events.length === 0 ? <span className="text-[13px] text-subtle">{t('card.briefing.none')}</span> : null}
            {c.events.map((e) => (
              <span key={`${e.time}-${e.title}`} className="flex gap-2.5 text-[13px] text-text">
                <span className="tabular w-10 shrink-0 text-muted">{e.time}</span>
                <span>{e.title}</span>
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold tracking-[.06em] text-subtle uppercase">{t('card.email')}</span>
            {c.emails.length === 0 ? <span className="text-[13px] text-subtle">{t('card.briefing.none')}</span> : null}
            {c.emails.map((e) => (
              <span key={`${e.from}-${e.subject}`} className="flex flex-col text-[13px] leading-[1.35]">
                <b className="font-semibold text-text">{e.from}</b>
                <span className="truncate text-muted">{e.subject}</span>
              </span>
            ))}
          </div>
        </div>
      );
      break;
  }

  const awaiting = c.type === 'approval-needed' && !resolved && pending;
  return (
    <div className="pl-[34px] font-sans">
      <div
        className="flex max-w-[560px] flex-col gap-2.5 rounded-[14px] border bg-surface-raised p-[14px]"
        style={{
          borderColor: awaiting ? 'color-mix(in oklab, var(--color-warning) 55%, transparent)' : 'var(--color-border)',
        }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[8px]"
            style={{ color, background: `color-mix(in oklab, ${color} 15%, transparent)` }}
          >
            <I size={15} aria-hidden="true" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-px">
            <span className="text-[13.5px] font-semibold text-text">{title}</span>
            {sub ? <span className="truncate text-[12px] text-muted">{sub}</span> : null}
          </div>
          {big ? (
            <span
              className="tabular text-[22px] font-semibold tracking-[-0.02em] text-text"
              role={c.type === 'timer' ? 'timer' : undefined}
            >
              {big}
            </span>
          ) : null}
          {button}
        </div>
        {body ? <p className="text-pretty m-0 text-[13px] leading-[1.5] text-muted">{body}</p> : null}
        {c.type === 'timer' ? (
          <div className="h-1 overflow-hidden rounded-pill bg-surface-sunken">
            <div
              className="h-full origin-left rounded-pill bg-accent transition-transform duration-1000 ease-linear"
              style={{ transform: `scaleX(${Math.max(0, Math.min(100, timerPct)) / 100})` }}
            />
          </div>
        ) : null}
        {extra}
      </div>
    </div>
  );
}
