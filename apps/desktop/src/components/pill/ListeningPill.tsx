/** S1 — Listening Pill. Presentational: state in via props, decisions out via callbacks (brief §7). */
import { BellOff, Lock, RotateCcw, Square } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { type MessageKey, useT } from '../../i18n';
import { cn } from '../../lib/cn';
import type { ListeningPillProps, PillState } from '../../types/ui';
import { KeyHint } from '../common/common';
import { Orb, type OrbState } from '../orb/Orb';
import { Button } from '../ui/button';
import { Badge } from '../ui/primitives';
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
    case 'clarify':
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

/** Partial words in subtle colour, committed words in full text colour; edges fade on overflow. */
export function LiveTranscript({ committed, partial }: { committed: string; partial: string }) {
  return (
    <p
      aria-live="polite"
      className="line-clamp-2 min-w-0 flex-1 text-sm leading-tight [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-12px),transparent)]"
    >
      <span className="text-text">{committed}</span>
      {committed && partial ? ' ' : null}
      <span className="text-subtle">{partial}</span>
    </p>
  );
}

function SpeakingText({ text, progress }: { text: string; progress: number }) {
  const cut = Math.round(Math.max(0, Math.min(1, progress)) * text.length);
  return (
    <p aria-live="polite" className="line-clamp-2 min-w-0 flex-1 text-sm leading-tight">
      <span className="text-text">{text.slice(0, cut)}</span>
      <span className="text-muted">{text.slice(cut)}</span>
    </p>
  );
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
  const t = useT();
  const reduce = useReducedMotion();
  const visible = state.kind !== 'hidden';
  const expanded = isExpanded(state);
  const level = state.kind === 'listening' || state.kind === 'speaking' ? state.level : 0;

  return (
    <AnimatePresence>
      {visible ? (
        <motion.section
          key="pill"
          aria-label={t('pill.label')}
          layout={!reduce}
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
          transition={{ duration: reduce ? 0.1 : 0.24, ease: [0.34, 1.56, 0.64, 1] }}
          data-state={state.kind}
          className={cn(
            'flex flex-col gap-3 border border-border bg-bg text-text shadow-lg',
            expanded ? 'w-[560px] max-w-full rounded-xl p-4' : 'w-[360px] max-w-full rounded-pill px-3 py-3',
            privateMode && 'border-private/60',
          )}
        >
          <div className="flex items-center gap-3">
            <Orb size={40} state={orbStateFor(state)} level={level} privateMode={privateMode} />
            <PillBody state={state} platform={platform} />
            {privateMode ? (
              <Badge tone="private">
                <Lock size={11} aria-hidden="true" />
                {t('pill.private')}
              </Badge>
            ) : null}
            {state.kind === 'thinking' && state.brain ? (
              <Badge tone="accent">{t('pill.using', { brain: t(`brain.${state.brain}` as MessageKey) })}</Badge>
            ) : null}
            {state.kind === 'speaking' ? (
              <Button variant="ghost" size="sm" onClick={onStop} aria-label={t('pill.stop')}>
                <Square size={12} aria-hidden="true" />
                {t('pill.stop')}
              </Button>
            ) : null}
          </div>

          {state.kind === 'clarify' ? (
            <div className="flex flex-wrap items-center gap-2">
              {state.quickReplies.map((r) => (
                <Button key={r} variant="secondary" size="sm" onClick={() => onQuickReply?.(r)}>
                  {r}
                </Button>
              ))}
              <span className="text-xs text-subtle">{t('pill.clarify.orSay')}</span>
            </div>
          ) : null}

          {state.kind === 'error' ? (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={onErrorAction}>
                <RotateCcw size={12} aria-hidden="true" />
                {state.actionLabel ?? t('pill.error.retry')}
              </Button>
            </div>
          ) : null}

          {state.kind === 'approval' ? (
            <ApprovalCard request={state.request} onDecision={onApprovalDecision} />
          ) : null}
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}

function PillBody({ state, platform }: { state: PillState; platform: ListeningPillProps['platform'] }) {
  const t = useT();
  switch (state.kind) {
    case 'idle-hint':
      return (
        <p className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-sm text-muted">
          {t('pill.idleHint')} <KeyHint keys={state.shortcut} platform={platform} />
        </p>
      );
    case 'listening':
      return state.committed || state.partial ? (
        <LiveTranscript committed={state.committed} partial={state.partial} />
      ) : (
        <p className="flex-1 text-sm text-muted">{t('pill.listening')}</p>
      );
    case 'thinking':
      return (
        <p aria-live="polite" className="line-clamp-2 min-w-0 flex-1 text-sm text-muted [animation:shimmer_1.6s_ease-in-out_infinite]">
          {state.transcript || t('pill.thinking')}
        </p>
      );
    case 'speaking':
      return <SpeakingText text={state.text} progress={state.progress} />;
    case 'clarify':
      return (
        <p aria-live="polite" className="min-w-0 flex-1 text-sm font-medium">
          {state.question}
        </p>
      );
    case 'approval':
      return <p className="min-w-0 flex-1 text-sm font-medium">{t('pill.approval')}</p>;
    case 'error':
      return (
        <p role="alert" className="min-w-0 flex-1 text-sm text-danger">
          {state.message}
        </p>
      );
    case 'muted':
      return (
        <p className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-subtle">
          <BellOff size={14} aria-hidden="true" />
          {state.reason === 'focus' ? t('pill.muted.focus') : t('pill.muted.user')}
        </p>
      );
    default:
      return null;
  }
}
