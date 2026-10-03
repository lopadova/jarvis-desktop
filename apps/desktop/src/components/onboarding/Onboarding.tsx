/** S4 — Onboarding: welcome · microphone · brain · voice · try it. */
import type { Settings as SettingsData } from '@jarvis/core';
import { Cpu, KeyRound, Mic, Play, ShieldCheck, Terminal } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { type MessageKey, useT } from '../../i18n';
import { cn } from '../../lib/cn';
import type { Locale, PillState, Platform, ProviderStatus } from '../../types/ui';
import { ProviderBadge } from '../common/common';
import { Orb } from '../orb/Orb';
import { ListeningPill } from '../pill/ListeningPill';
import type { SecretKey } from '../settings/Settings';
import { LevelMeter } from '../settings/Settings';
import { Button } from '../ui/button';
import { Input, NativeSelect } from '../ui/primitives';

type TtsId = SettingsData['tts'];
export const ONBOARDING_STEPS = ['welcome', 'microphone', 'brain', 'voice', 'try'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingProps {
  platform: Platform;
  locale: Locale;
  providers: ProviderStatus[];
  micLevel: number;
  tts: TtsId;
  pill: PillState;
  privateMode: boolean;
  onMicMonitor(enabled: boolean): void;
  onSignInChatGpt(): void;
  onSecret(key: SecretKey, value: string): void;
  onUseLocal(): void;
  onUseClaude(): void;
  onTts(tts: TtsId): void;
  onPreview(tts: TtsId): void;
  onLocale(locale: Locale): void;
  onFinish(): void;
}

export function Onboarding(p: OnboardingProps) {
  const t = useT();
  const [i, setI] = useState(0);
  const step = ONBOARDING_STEPS[i] ?? 'welcome';
  const { onMicMonitor } = p;

  useEffect(() => {
    onMicMonitor(step === 'microphone');
  }, [step, onMicMonitor]);
  useEffect(() => () => onMicMonitor(false), [onMicMonitor]);

  const last = i === ONBOARDING_STEPS.length - 1;
  return (
    <div className="flex h-full flex-col">
      <div data-tauri-drag-region className="h-8 shrink-0" />
      <main className="scroll-y flex min-h-0 flex-1 flex-col items-center px-10" aria-live="polite">
        {step === 'welcome' ? (
          <Step title={t('onboarding.welcome.title')} body={t('onboarding.welcome.body')}>
            <Orb size={160} state="idle" />
          </Step>
        ) : null}
        {step === 'microphone' ? (
          <Step title={t('onboarding.mic.title')} body={t('onboarding.mic.body')}>
            <div className="flex w-80 flex-col items-center gap-3">
              <Mic size={32} className="text-accent" aria-hidden="true" />
              <LevelMeter level={p.micLevel} label={t('onboarding.mic.level')} />
              <p className="flex items-center gap-1.5 text-xs text-subtle">
                <ShieldCheck size={12} aria-hidden="true" />
                {t('onboarding.mic.promise')}
              </p>
            </div>
          </Step>
        ) : null}
        {step === 'brain' ? <BrainStep {...p} /> : null}
        {step === 'voice' ? <VoiceStep {...p} /> : null}
        {step === 'try' ? (
          <Step title={t('onboarding.try.title')} body={t('onboarding.try.body')}>
            <ListeningPill
              state={p.pill.kind === 'hidden' ? { kind: 'idle-hint', shortcut: ['Alt', 'Space'] } : p.pill}
              privateMode={p.privateMode}
              platform={p.platform}
            />
          </Step>
        ) : null}
      </main>
      <footer className="flex items-center justify-between px-8 py-5">
        <Button variant="ghost" disabled={i === 0} onClick={() => setI((x) => Math.max(0, x - 1))}>
          {t('common.back')}
        </Button>
        <ol className="flex gap-2" aria-label={t('onboarding.progress', { n: i + 1, total: ONBOARDING_STEPS.length })}>
          {ONBOARDING_STEPS.map((s, idx) => (
            <li
              key={s}
              aria-current={idx === i ? 'step' : undefined}
              className={cn('h-2 w-2 rounded-full', idx === i ? 'bg-accent' : 'bg-border-strong')}
            />
          ))}
        </ol>
        <Button variant="primary" size="lg" onClick={() => (last ? p.onFinish() : setI((x) => x + 1))}>
          {i === 0 ? t('onboarding.start') : last ? t('onboarding.finish') : t('common.next')}
        </Button>
      </footer>
    </div>
  );
}

function Step({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <section className="flex w-full max-w-xl flex-col items-center gap-5 py-6 text-center">
      {children}
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-muted">{body}</p>
    </section>
  );
}

function Card({ icon, title, body, children }: { icon: ReactNode; title: string; body: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-left">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className="text-accent">{icon}</span>
        {title}
      </div>
      <p className="text-xs text-muted">{body}</p>
      {children ? <div className="flex flex-wrap items-center gap-2 pt-1">{children}</div> : null}
    </div>
  );
}

function BrainStep(p: OnboardingProps) {
  const t = useT();
  const [provider, setProvider] = useState<'anthropic-api-key' | 'openai-api-key'>('anthropic-api-key');
  const [key, setKey] = useState('');
  const claude = p.providers.find((x) => x.id === 'claude');
  const chatgpt = p.providers.find((x) => x.id === 'chatgpt');
  return (
    <section className="flex w-full flex-col gap-3 py-2">
      <h1 className="text-center text-2xl font-semibold">{t('onboarding.brain.title')}</h1>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
          {/* Slot reserved for the official "Sign in with ChatGPT" asset (280×44, neutral surroundings). */}
          <button
            type="button"
            onClick={p.onSignInChatGpt}
            className="flex h-[44px] w-full max-w-[280px] items-center justify-center rounded-md border border-border-strong bg-surface-raised text-sm font-medium"
          >
            {t('onboarding.brain.chatgpt')}
          </button>
          <p className="text-xs text-muted">{t('onboarding.brain.chatgpt.sub')}</p>
          {chatgpt ? (
            <div className="flex">
              <ProviderBadge provider={chatgpt} />
            </div>
          ) : null}
        </div>
        <Card
          icon={<Terminal size={16} />}
          title={t('onboarding.brain.claude')}
          body={t('onboarding.brain.claude.sub')}
        >
          <div className="flex items-center gap-2">
            {claude ? (
              <ProviderBadge provider={claude} />
            ) : (
              <span className="text-xs text-subtle">{t('onboarding.brain.detecting')}</span>
            )}
            {claude?.connected ? (
              <Button size="sm" onClick={p.onUseClaude}>
                {t('onboarding.brain.use')}
              </Button>
            ) : null}
          </div>
        </Card>
        <Card icon={<KeyRound size={16} />} title={t('onboarding.brain.api')} body={t('onboarding.brain.api.sub')}>
          <form
            className="flex w-full flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!key.trim()) return;
              p.onSecret(provider, key.trim()); // sent to the keyring via secrets.set; never stored in the UI
              setKey('');
            }}
          >
            <NativeSelect
              aria-label={t('onboarding.brain.api.provider')}
              value={provider}
              onChange={(e) => setProvider(e.target.value as typeof provider)}
              className="w-full"
            >
              <option value="anthropic-api-key">Anthropic</option>
              <option value="openai-api-key">OpenAI</option>
            </NativeSelect>
            <Input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              aria-label={t('onboarding.brain.api.key')}
              placeholder={t('onboarding.brain.api.key')}
            />
            <Button type="submit" size="sm" variant="primary" disabled={!key.trim()}>
              {t('common.save')}
            </Button>
          </form>
        </Card>
        <Card icon={<Cpu size={16} />} title={t('onboarding.brain.local')} body={t('onboarding.brain.local.sub')}>
          <Button size="sm" onClick={p.onUseLocal}>
            {t('onboarding.brain.use')}
          </Button>
        </Card>
      </div>
    </section>
  );
}

const TTS_OPTIONS: TtsId[] = ['elevenlabs', 'fish', 'openai', 'kokoro', 'system'];

function VoiceStep(p: OnboardingProps) {
  const t = useT();
  return (
    <section className="flex w-full flex-col gap-3 py-2">
      <h1 className="text-center text-2xl font-semibold">{t('onboarding.voice.title')}</h1>
      <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label={t('onboarding.voice.title')}>
        {TTS_OPTIONS.map((id) => (
          <div
            key={id}
            className={cn(
              'flex items-center gap-2 rounded-lg border bg-surface p-3',
              p.tts === id ? 'border-accent' : 'border-border',
            )}
          >
            <button
              type="button"
              role="radio"
              aria-checked={p.tts === id}
              className="flex-1 text-left text-sm font-medium"
              onClick={() => p.onTts(id)}
            >
              {t(`tts.${id}` as MessageKey)}
            </button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('voice.previewOf', { name: t(`tts.${id}` as MessageKey) })}
              onClick={() => p.onPreview(id)}
            >
              <Play size={12} aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-2">
        <span className="text-sm text-muted">{t('settings.language')}</span>
        {(['en', 'it'] as const).map((l) => (
          <Button
            key={l}
            size="sm"
            variant={p.locale === l ? 'primary' : 'secondary'}
            onClick={() => p.onLocale(l)}
            aria-pressed={p.locale === l}
          >
            {l === 'en' ? 'English' : 'Italiano'}
          </Button>
        ))}
      </div>
    </section>
  );
}
