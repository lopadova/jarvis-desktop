/** Composer: text + hold-to-talk mic + provider (brain) switcher + send (brief §5 S3). */
import { Mic, SendHorizontal } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useState } from 'react';
import { type MessageKey, useT } from '../../i18n';
import { cn } from '../../lib/cn';
import type { BrainId, Platform, ProviderStatus } from '../../types/ui';
import { KeyHint } from '../common/common';
import { Button } from '../ui/button';
import { NativeSelect } from '../ui/primitives';

export interface ComposerProps {
  providers: ProviderStatus[];
  primary: BrainId | null;
  recording: boolean;
  disabled?: boolean;
  platform: Platform;
  pushToTalkKeys: string[];
  onSubmit(text: string): void;
  onPushToTalk(pressed: boolean): void;
  onPrimaryChange(brain: BrainId): void;
}

export function Composer({
  providers,
  primary,
  recording,
  disabled,
  platform,
  pushToTalkKeys,
  onSubmit,
  onPushToTalk,
  onPrimaryChange,
}: ComposerProps) {
  const t = useT();
  const [text, setText] = useState('');

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const v = text.trim();
    if (!v || disabled) return;
    onSubmit(v);
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };
  const micKey = (e: KeyboardEvent<HTMLButtonElement>, pressed: boolean) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!e.repeat) onPushToTalk(pressed);
    }
  };
  const connected = providers.filter((p) => p.connected);

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      <div
        className={cn(
          'flex items-center gap-2 rounded-[28px] border bg-surface py-1.5 ps-1.5 pe-1.5 shadow-md transition-colors',
          recording ? 'border-accent' : 'border-border',
        )}
      >
        <Button
          variant={recording ? 'primary' : 'ghost'}
          size="icon"
          className="h-9 w-9 rounded-pill"
          aria-label={t('composer.mic')}
          aria-pressed={recording}
          disabled={disabled}
          onPointerDown={() => onPushToTalk(true)}
          onPointerUp={() => onPushToTalk(false)}
          onPointerLeave={() => recording && onPushToTalk(false)}
          onKeyDown={(e) => micKey(e, true)}
          onKeyUp={(e) => micKey(e, false)}
        >
          <Mic size={16} aria-hidden="true" />
        </Button>
        <textarea
          rows={1}
          value={text}
          disabled={disabled}
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={recording ? t('composer.listening') : t('composer.placeholder')}
          aria-label={t('composer.placeholder')}
          className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none placeholder:text-subtle"
        />
        <label className="sr-only" htmlFor="brain-select">
          {t('composer.brain')}
        </label>
        <NativeSelect
          id="brain-select"
          value={primary ?? ''}
          onChange={(e) => onPrimaryChange(e.target.value as BrainId)}
          className="shrink-0 [&>select]:rounded-pill [&>select]:text-xs [&>select]:text-muted"
        >
          {primary === null ? <option value="">{t('composer.noBrain')}</option> : null}
          {(connected.length ? connected : providers).map((p) => (
            <option key={p.id} value={p.id}>
              {t(`brain.${p.id}` as MessageKey)}
            </option>
          ))}
        </NativeSelect>
        <Button
          type="submit"
          variant="primary"
          size="icon"
          className="h-9 w-9 rounded-pill"
          disabled={!text.trim() || disabled}
          aria-label={t('composer.send')}
        >
          <SendHorizontal size={16} aria-hidden="true" />
        </Button>
      </div>
      <p className="flex items-center gap-1.5 px-2 text-xs text-subtle">
        {t('composer.hint')} <KeyHint keys={pushToTalkKeys} platform={platform} />
      </p>
    </form>
  );
}
