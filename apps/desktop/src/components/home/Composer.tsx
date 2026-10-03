/**
 * Composer (brief §5 S3, handoff composer): attach clipboard/screenshot · text · brain switcher ·
 * mic (click to talk, hold to talk while pressed) · send.
 */
import { ArrowUp, Brain, ChevronDown, Clipboard, Mic, ScreenShare } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { type MessageKey, useT } from '../../i18n';
import { cn } from '../../lib/cn';
import { useNow } from '../../lib/motion';
import type { BrainId, Platform, ProviderStatus } from '../../types/ui';
import { keyLabel } from '../common/common';

export interface ComposerProps {
  providers: ProviderStatus[];
  primary: BrainId | null;
  privateMode?: boolean;
  recording: boolean;
  /** 0..1 live mic level (waveform while recording). */
  level?: number;
  disabled?: boolean;
  platform: Platform;
  pushToTalkKeys: string[];
  localModel?: string;
  onSubmit(text: string): void;
  onPushToTalk(pressed: boolean): void;
  onPrimaryChange(brain: BrainId): void;
  onAttachClipboard?(): Promise<string | null>;
  onAttachScreenshot?(): void;
}

const HOLD_MS = 350;

const stateDot = (p: ProviderStatus) =>
  p.id === 'local'
    ? 'var(--color-private)'
    : p.state === 'ok'
      ? 'var(--color-success)'
      : p.state === 'needs-login'
        ? 'var(--color-warning)'
        : p.state === 'not-installed'
          ? 'var(--color-text-subtle)'
          : 'var(--color-danger)';

const round =
  'grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-pill border-0 bg-transparent text-muted hover:bg-surface-raised hover:text-text disabled:cursor-default disabled:opacity-45';

export function Composer({
  providers,
  primary,
  privateMode,
  recording,
  level = 0,
  disabled,
  platform,
  pushToTalkKeys,
  localModel,
  onSubmit,
  onPushToTalk,
  onPrimaryChange,
  onAttachClipboard,
  onAttachScreenshot,
}: ComposerProps) {
  const t = useT();
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(false);
  const press = useRef<{ at: number; stopping: boolean } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const now = useNow(recording, 110);

  const brainName = (id: BrainId) => t(`brain.${id}` as MessageKey);
  const listed = providers.filter((p) => p.connected || p.state !== 'not-installed' || p.id === 'local');
  const options = listed.length ? listed : providers;
  const label = privateMode ? brainName('local') : primary ? brainName(primary) : t('composer.noBrain');
  const note = (p: ProviderStatus) => {
    if (p.state === 'cap-reached') return t('composer.capReached');
    if (p.state === 'needs-login' || p.state === 'not-installed' || p.state === 'error')
      return t(`provider.state.${p.state}` as MessageKey);
    if (p.id === 'local') return localModel ?? '';
    const plan = (p.plan ?? '').replace(brainName(p.id), '').trim();
    return [plan, p.usagePct !== undefined && p.usagePct >= 80 ? `${Math.round(p.usagePct)}%` : '']
      .filter(Boolean)
      .join(' · ');
  };

  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  const submit = () => {
    const v = text.trim();
    if (!v || disabled) return;
    onSubmit(v);
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  // Click = toggle; press-and-hold = talk while pressed.
  const micDown = () => {
    if (disabled) return;
    if (recording) {
      press.current = { at: Date.now(), stopping: true };
      return;
    }
    press.current = { at: Date.now(), stopping: false };
    onPushToTalk(true);
  };
  const micUp = () => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    if (p.stopping || Date.now() - p.at > HOLD_MS) onPushToTalk(false);
  };
  const micKey = (e: KeyboardEvent<HTMLButtonElement>, down: boolean) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (e.repeat) return;
      if (down) micDown();
      else micUp();
    }
  };

  const kAlt = pushToTalkKeys.map((k) => keyLabel(k, platform)).join(platform === 'mac' ? ' ' : ' + ');
  const cantSend = !text.trim() || disabled;

  return (
    <div className="relative">
      {menu ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('composer.brain')}
          className="absolute right-24 bottom-[60px] z-[5] flex w-60 flex-col gap-0.5 rounded-[12px] border border-border-strong bg-surface-raised p-1.5 shadow-lg"
        >
          {options.map((p) => {
            const on = (privateMode ? 'local' : primary) === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                onClick={() => {
                  onPrimaryChange(p.id);
                  setMenu(false);
                }}
                className={cn(
                  'flex h-9 cursor-pointer items-center gap-2.5 rounded-[8px] border-0 px-2.5 text-left text-[13px] font-medium text-text hover:bg-surface-sunken',
                  on ? 'bg-accent-soft' : 'bg-transparent',
                )}
              >
                <span className="h-2 w-2 shrink-0 rounded-pill" style={{ background: stateDot(p) }} />
                <span className="flex-1">{brainName(p.id)}</span>
                <span className="text-[11.5px] text-subtle">{note(p)}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <div
        className="box-border flex h-14 items-center gap-1 rounded-pill border bg-surface-raised px-2 transition-[border-color,box-shadow] duration-[160ms]"
        style={{
          borderColor: recording ? 'var(--color-accent)' : 'var(--color-border-strong)',
          boxShadow: recording ? 'var(--shadow-glow)' : 'var(--shadow-md)',
          opacity: disabled ? 0.45 : 1,
        }}
      >
        <button
          type="button"
          aria-label={t('composer.attachClip')}
          title={t('composer.attachClip')}
          disabled={disabled}
          className={round}
          onClick={async () => {
            const clip = await onAttachClipboard?.();
            if (clip) setText((v) => (v ? `${v} ${clip}` : clip));
          }}
        >
          <Clipboard size={17} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={t('composer.attachShot')}
          title={t('composer.attachShot')}
          disabled={disabled}
          className={round}
          onClick={onAttachScreenshot}
        >
          <ScreenShare size={17} aria-hidden="true" />
        </button>
        {recording ? (
          <div
            role="status"
            aria-label={t('composer.recording')}
            className="flex h-9 min-w-0 flex-1 items-center gap-[3px] px-1.5"
          >
            {Array.from({ length: 24 }, (_, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length decorative waveform.
                key={i}
                className="h-[26px] w-[3px] origin-center rounded-[2px] bg-accent opacity-80 transition-transform duration-[110ms] ease-linear"
                style={{
                  transform: `scaleY(${Math.max(0.15, Math.min(1, level * (0.5 + 0.5 * Math.sin(i * 1.7 + now / 300))))})`,
                }}
              />
            ))}
            <span className="ml-2.5 text-[12.5px] whitespace-nowrap text-muted">{t('composer.recording')}</span>
          </div>
        ) : (
          <input
            value={text}
            disabled={disabled}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder={disabled ? t('composer.offline') : t('composer.placeholder', { k: kAlt })}
            aria-label={t('composer.aria')}
            className="h-9 min-w-0 flex-1 border-0 bg-transparent px-1.5 font-sans text-[14px] text-text outline-none placeholder:text-subtle"
          />
        )}
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menu}
          disabled={disabled}
          onClick={() => setMenu((m) => !m)}
          className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-pill border border-border bg-surface-sunken px-2.5 text-[12px] font-semibold text-muted hover:text-text"
        >
          <Brain size={13} aria-hidden="true" />
          {label}
          <ChevronDown size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={t('composer.mic')}
          aria-pressed={recording}
          title={t('composer.micTitle')}
          disabled={disabled}
          onPointerDown={micDown}
          onPointerUp={micUp}
          onPointerLeave={() => press.current && micUp()}
          onKeyDown={(e) => micKey(e, true)}
          onKeyUp={(e) => micKey(e, false)}
          className={cn(
            'grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-pill border-0 disabled:cursor-default',
            recording ? 'bg-accent text-accent-contrast' : 'bg-accent-soft text-text',
          )}
        >
          <Mic size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={cantSend}
          aria-label={t('composer.send')}
          className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-pill border-0',
            cantSend ? 'cursor-default bg-surface-sunken text-subtle' : 'cursor-pointer bg-accent text-accent-contrast',
          )}
        >
          <ArrowUp size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
