/**
 * S1 — Listening Pill (handoff `ListeningPill.dc.html`). Presentational: state in via props, decisions
 * out via callbacks (brief §7). 360×64 collapsed; 560 wide when it needs room (clarify/approval/error).
 */
import {
  AudioLines,
  CircleAlert,
  Keyboard,
  Lock,
  type LucideIcon,
  MessageCircleQuestionMark,
  Mic,
  MicOff,
  ShieldAlert,
  Sparkles,
  Square,
} from 'lucide-react';
import { type CSSProperties, useEffect, useState } from 'react';
import { type MessageKey, useT } from '../../i18n';
import { useMotion } from '../../lib/motion';
import type { ListeningPillProps, PillState } from '../../types/ui';
import { chipStyle, KeyHint } from '../common/common';
import { Orb, type OrbState } from '../orb/Orb';
import { ApprovalCard } from './ApprovalCard';

export function orbStateFor(state: PillState): OrbState {
  switch (state.kind) {
    case 'listening':
      return 'listening';
    case 'thinking':
      return 'thinking';
    case 'speaking':
      return 'speaking';
    case 'approval':
      return 'approval';
    case 'error':
      return 'error';
    case 'muted':
      return 'muted';
    default:
      return 'idle';
  }
}

export function isExpanded(state: PillState): boolean {
  return state.kind === 'approval' || state.kind === 'clarify' || state.kind === 'error';
}

const MAX_WORDS = 14;

/** Partial words in subtle colour, committed words in full text colour; the trailing edge fades. */
export function LiveTranscript({
  committed,
  partial,
  animated,
}: {
  committed: string;
  partial: string;
  animated?: boolean;
}) {
  let words = committed.split(' ').filter(Boolean);
  if (words.length > MAX_WORDS) words = ['…', ...words.slice(-(MAX_WORDS - 1))];
  return (
    <div
      className="line-clamp-2 text-[14px] leading-[1.4]"
      style={{
        maskImage: 'linear-gradient(90deg,#000 85%,transparent)',
        WebkitMaskImage: 'linear-gradient(90deg,#000 85%,transparent)',
      }}
    >
      {words.map((w, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: words stream in order and are never reordered.
          key={i}
          className="text-text"
          style={{ animation: animated && i === words.length - 1 ? 'jv-word 120ms ease-out' : 'none' }}
        >
          {w}{' '}
        </span>
      ))}
      <span className="text-subtle">{partial}</span>
    </div>
  );
}

function SpeakingText({ text, progress }: { text: string; progress: number }) {
  const words = text.split(' ');
  const cut = Math.round(Math.max(0, Math.min(1, progress)) * words.length);
  return (
    <div className="line-clamp-2 text-[14px] leading-[1.4]">
      {words.map((w, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: words of a fixed reply; order never changes.
          key={i}
          style={{ color: i < cut ? 'var(--color-text)' : 'var(--color-text-subtle)', transition: 'color 120ms' }}
        >
          {w}{' '}
        </span>
      ))}
    </div>
  );
}

const shimmer = (anim: boolean): CSSProperties => ({
  fontSize: 14,
  lineHeight: 1.4,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  color: 'var(--color-text-muted)',
  // Paint-only shimmer on a two-line span, paused when hidden and off under reduced motion.
  backgroundImage: anim
    ? 'linear-gradient(90deg, var(--color-text-muted) 0%, var(--color-text-muted) 40%, var(--color-text) 50%, var(--color-text-muted) 60%, var(--color-text-muted) 100%)'
    : 'none',
  backgroundSize: '200% 100%',
  WebkitBackgroundClip: anim ? 'text' : 'border-box',
  backgroundClip: anim ? 'text' : 'border-box',
  WebkitTextFillColor: anim ? 'transparent' : 'currentColor',
  animation: anim ? 'jv-shimmer 1.8s linear infinite' : 'none',
});

/** Keeps the last visible state around for the 180 ms hide animation. */
function usePresence(state: PillState, anim: boolean): { shown: PillState | null; leaving: boolean } {
  const [last, setLast] = useState<PillState | null>(state.kind === 'hidden' ? null : state);
  const visible = state.kind !== 'hidden';
  useEffect(() => {
    if (visible) {
      setLast(state);
      return;
    }
    if (!anim) {
      setLast(null);
      return;
    }
    const id = setTimeout(() => setLast(null), 180);
    return () => clearTimeout(id);
  }, [state, visible, anim]);
  if (visible) return { shown: state, leaving: false };
  return { shown: last, leaving: last !== null };
}

export function ListeningPill({
  state,
  privateMode,
  platform,
  onStop,
  onQuickReply,
  onErrorAction,
  onApprovalDecision,
}: ListeningPillProps) {
  const anim = useMotion();
  const { shown, leaving } = usePresence(state, anim);
  if (!shown) return null;
  return (
    <PillShell
      state={shown}
      leaving={leaving}
      anim={anim}
      privateMode={privateMode}
      platform={platform}
      onStop={onStop}
      onQuickReply={onQuickReply}
      onErrorAction={onErrorAction}
      onApprovalDecision={onApprovalDecision}
    />
  );
}

function PillShell({
  state: st,
  leaving,
  anim,
  privateMode,
  platform,
  onStop,
  onQuickReply,
  onErrorAction,
  onApprovalDecision,
}: ListeningPillProps & { leaving: boolean; anim: boolean }) {
  const t = useT();
  const k = st.kind;
  const expanded = isExpanded(st);
  const level = st.kind === 'listening' || st.kind === 'speaking' ? st.level : 0;
  const req = st.kind === 'approval' ? st.request : undefined;

  const chips: Partial<Record<PillState['kind'], [string, LucideIcon, string]>> = {
    listening:
      st.kind === 'listening' && st.dictation
        ? [t('pill.chip.dictation'), Keyboard, 'var(--color-accent)']
        : [t('pill.chip.listening'), Mic, 'var(--color-accent)'],
    thinking: [
      st.kind === 'thinking' && st.brain
        ? t('pill.using', { brain: t(`brain.${st.brain}` as MessageKey) })
        : t('pill.chip.thinking'),
      Sparkles,
      'var(--color-text-muted)',
    ],
    speaking: [t('pill.chip.speaking'), AudioLines, 'var(--color-ember)'],
    clarify: [t('pill.chip.yourTurn'), MessageCircleQuestionMark, 'var(--color-accent)'],
    approval: [t('pill.chip.approval'), ShieldAlert, 'var(--color-warning)'],
    error: [t('pill.chip.error'), CircleAlert, 'var(--color-danger)'],
    muted: [t('pill.chip.muted'), MicOff, 'var(--color-text-subtle)'],
  };
  const chip = chips[k];
  const ChipIcon = chip?.[1];
  const headline =
    st.kind === 'clarify'
      ? st.question
      : st.kind === 'error'
        ? st.message
        : req
          ? t('pill.approvalHead', { agent: t(`agent.${req.agent}` as MessageKey) })
          : '';

  const border = privateMode
    ? 'color-mix(in oklab, var(--color-private) 45%, transparent)'
    : req?.risk === 'high'
      ? 'var(--color-danger)'
      : 'var(--color-border)';

  return (
    <section
      role={k === 'approval' ? 'group' : 'status'}
      aria-label={t('pill.label')}
      data-state={k}
      className="glass box-border flex min-h-16 flex-col justify-center gap-[14px] bg-surface font-sans text-text shadow-lg"
      style={{
        width: expanded ? 560 : 360,
        maxWidth: '100%',
        padding: expanded ? '12px 16px 16px 12px' : '0 12px',
        borderRadius: expanded ? 24 : 32,
        border: `1px solid ${border}`,
        transition: anim ? 'width 260ms var(--ease-emphasized), border-radius 260ms' : 'none',
        animation: anim
          ? leaving
            ? 'jv-pill-out 180ms var(--ease-standard) both'
            : 'jv-pill-in 240ms var(--ease-spring-like)'
          : 'none',
      }}
    >
      <div className="flex items-center gap-3" style={{ minHeight: expanded ? 40 : 64 }}>
        <Orb size={40} state={orbStateFor(st)} level={level} privateMode={privateMode} animated={anim} />
        <div aria-live="polite" className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          {st.kind === 'idle-hint' ? (
            <span className="flex flex-wrap items-center gap-1.5 text-[13.5px] text-muted">
              {t('pill.idle.say')} <b className="font-semibold text-text italic">Jarvis</b> {t('pill.idle.orHold')}
              <KeyHint keys={st.shortcut} platform={platform} small />
            </span>
          ) : null}
          {st.kind === 'listening' ? (
            st.committed || st.partial ? (
              <LiveTranscript committed={st.committed} partial={st.partial} animated={anim} />
            ) : (
              <span className="text-[14px] text-muted">{st.dictation ? t('pill.dictation') : t('pill.listening')}</span>
            )
          ) : null}
          {st.kind === 'thinking' ? <span style={shimmer(anim)}>{st.transcript || t('pill.thinking')}</span> : null}
          {st.kind === 'speaking' ? <SpeakingText text={st.text} progress={st.progress} /> : null}
          {expanded ? (
            <span
              role={st.kind === 'error' ? 'alert' : undefined}
              className="text-pretty text-[14.5px] leading-[1.35] font-semibold text-text"
            >
              {headline}
            </span>
          ) : null}
          {st.kind === 'muted' ? (
            <span className="text-[13.5px] text-muted">
              {st.reason === 'focus' ? t('pill.muted.focus') : t('pill.muted.user')}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {chip && ChipIcon ? (
            <span style={chipStyle(chip[2], 20)} className="gap-1">
              <ChipIcon size={11} aria-hidden="true" />
              {chip[0]}
            </span>
          ) : null}
          {privateMode ? (
            <span style={chipStyle('var(--color-private)', 20)} className="!px-[7px]">
              <Lock size={10} aria-hidden="true" />
              {t('pill.private')}
            </span>
          ) : null}
        </div>
        {st.kind === 'speaking' ? (
          <button
            type="button"
            onClick={onStop}
            aria-label={t('pill.stop')}
            title={`${t('pill.stop')} (Esc)`}
            className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-pill border border-border-strong bg-surface-raised text-text hover:bg-surface-sunken"
          >
            <Square size={12} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {st.kind === 'clarify' ? (
        <div className="flex flex-wrap items-center gap-2 pl-[52px]">
          {st.quickReplies.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onQuickReply?.(r)}
              className="h-8 cursor-pointer rounded-pill border border-border-strong bg-surface-raised px-[14px] text-[13px] font-medium text-text hover:border-accent hover:bg-accent-soft active:scale-[.98]"
            >
              {r}
            </button>
          ))}
          <span className="text-[12.5px] text-subtle italic">{t('pill.clarify.orSay')}</span>
        </div>
      ) : null}

      {st.kind === 'error' ? (
        <div className="flex gap-2 pl-[52px]">
          {st.actionLabel ? (
            <button
              type="button"
              onClick={onErrorAction}
              className="h-8 cursor-pointer rounded-[9px] border-0 bg-accent px-[14px] text-[13px] font-semibold text-accent-contrast"
            >
              {st.actionLabel}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onStop}
            className="h-8 cursor-pointer rounded-[9px] border-0 bg-transparent px-3 text-[13px] font-medium text-muted hover:bg-surface-raised hover:text-text"
          >
            {t('common.dismiss')}
          </button>
        </div>
      ) : null}

      {st.kind === 'approval' ? <ApprovalCard request={st.request} onDecision={onApprovalDecision} embedded /> : null}
    </section>
  );
}
