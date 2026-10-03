/** S4 — Onboarding (handoff `Onboarding.dc.html`): welcome · microphone · brain · voice · try it. */
import type { Settings as SettingsData } from '@jarvis/core';
import {
  ArrowRight,
  CircleCheck,
  Cpu,
  KeyRound,
  Lock,
  MessageCircle,
  Mic,
  PartyPopper,
  Pause,
  Play,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { type MessageKey, useT } from '../../i18n';
import { useMotion } from '../../lib/motion';
import type { BrainId, Locale, PillState, Platform, ProviderStatus, SecretKey } from '../../types/ui';
import { chipStyle, MacLights, ProviderTile, Segmented } from '../common/common';
import { WindowFrame } from '../common/WindowFrame';
import { Orb } from '../orb/Orb';
import { ListeningPill } from '../pill/ListeningPill';

type TtsId = SettingsData['tts'];
export const ONBOARDING_STEPS = ['welcome', 'microphone', 'brain', 'voice', 'try'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingProps {
  platform: Platform;
  locale: Locale;
  providers: ProviderStatus[];
  primary?: BrainId | null;
  micLevel: number;
  tts: TtsId;
  pill: PillState;
  privateMode: boolean;
  onMicMonitor(enabled: boolean): void;
  onSignInChatGpt(): void;
  onSecret(key: SecretKey, value: string): void;
  onUseLocal(): void;
  onUseClaude(): void;
  onSetPrimary?(brain: BrainId): void;
  onTts(tts: TtsId): void;
  onPreview(tts: TtsId): void;
  onLocale(locale: Locale): void;
  /** "Try it": submit the sample utterance as if spoken. */
  onTry?(utterance: string): void;
  onFinish(): void;
  onClose?(): void;
}

export function Onboarding(p: OnboardingProps) {
  const t = useT();
  const anim = useMotion();
  const [i, setI] = useState(0);
  const step = ONBOARDING_STEPS[i] ?? 'welcome';
  const last = i === ONBOARDING_STEPS.length - 1;
  const stepAnim = anim ? 'jv-step 260ms var(--ease-standard)' : 'none';

  return (
    <WindowFrame platform={p.platform} width={720} height={560} onboarding role="dialog" label={t('onboarding.aria')}>
      <div data-tauri-drag-region className="flex h-10 shrink-0 items-center gap-2 px-[14px]">
        {p.platform === 'mac' ? <MacLights closeOnly onAction={() => p.onClose?.()} /> : null}
        <span data-tauri-drag-region className="flex-1 self-stretch" />
        <span className="tabular text-[12px] text-subtle">
          {t('onboarding.progress', { n: i + 1, total: ONBOARDING_STEPS.length })}
        </span>
        {p.platform !== 'mac' ? (
          <button
            type="button"
            aria-label={t('window.close')}
            onClick={() => p.onClose?.()}
            className="ml-2 grid h-7 w-8 cursor-pointer place-items-center rounded-[6px] border-0 bg-transparent text-muted hover:bg-[#c42b1c] hover:text-white"
          >
            <X size={15} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-10 pt-1">
        <div key={step} className="flex flex-1 flex-col" style={{ animation: stepAnim }}>
          {step === 'welcome' ? <WelcomeStep /> : null}
          {step === 'microphone' ? <MicStep {...p} /> : null}
          {step === 'brain' ? <BrainStep {...p} /> : null}
          {step === 'voice' ? <VoiceStep {...p} /> : null}
          {step === 'try' ? <TryStep {...p} anim={anim} /> : null}
        </div>
      </div>
      <div className="flex h-[72px] shrink-0 items-center gap-3 pr-6 pl-10">
        <ol aria-label={t('onboarding.progressLabel')} className="m-0 flex flex-1 list-none gap-1.5 p-0">
          {ONBOARDING_STEPS.map((s, idx) => (
            <li
              key={s}
              aria-current={idx === i ? 'step' : undefined}
              className="h-2 rounded-pill transition-[width,background] duration-[240ms] ease-standard"
              style={{
                width: idx === i ? 22 : 8,
                background: idx <= i ? 'var(--color-accent)' : 'var(--color-border-strong)',
              }}
            >
              <span className="sr-only">{t('onboarding.stepN', { n: idx + 1 })}</span>
            </li>
          ))}
        </ol>
        {i > 0 ? (
          <button
            type="button"
            onClick={() => setI((x) => Math.max(0, x - 1))}
            className="h-11 cursor-pointer rounded-[12px] border-0 bg-transparent px-[18px] text-[14px] font-semibold text-muted hover:bg-surface-raised hover:text-text"
          >
            {t('common.back')}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => (last ? p.onFinish() : setI((x) => x + 1))}
          className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-[12px] border-0 bg-accent px-[22px] text-[14px] font-semibold text-accent-contrast active:scale-[.98]"
        >
          {i === 0 ? t('onboarding.start') : last ? t('onboarding.finish') : t('onboarding.continue')}
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>
    </WindowFrame>
  );
}

function WelcomeStep() {
  const t = useT();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-7 text-center">
      <Orb size={160} state="idle" />
      <div className="flex flex-col items-center gap-3">
        <h1 className="m-0 text-[40px] leading-[1.05] font-[650] tracking-[-0.03em]">
          {t('onboarding.welcome.title')}
        </h1>
        <p className="text-pretty m-0 max-w-[440px] text-[16px] leading-[1.55] text-muted">
          {t('onboarding.welcome.body')}
        </p>
      </div>
    </div>
  );
}

const BARS = 32;

function MicStep(p: OnboardingProps) {
  const t = useT();
  const [on, setOn] = useState(false);
  const [hist, setHist] = useState<number[]>(() => Array(BARS).fill(0.05));
  const level = useRef(p.micLevel);
  level.current = p.micLevel;
  const { onMicMonitor } = p;

  useEffect(() => {
    if (!on) return;
    onMicMonitor(true);
    const id = setInterval(() => setHist((h) => [...h.slice(1), level.current]), 90);
    return () => {
      clearInterval(id);
      onMicMonitor(false);
    };
  }, [on, onMicMonitor]);

  return (
    <div className="flex flex-1 flex-col gap-6 pt-5">
      <div className="flex flex-col gap-2">
        <h2 className="m-0 text-[26px] font-[650] tracking-[-0.02em]">{t('onboarding.mic.title')}</h2>
        <p className="text-pretty m-0 max-w-[520px] text-[14.5px] leading-[1.55] text-muted">
          {t('onboarding.mic.body')}
        </p>
      </div>
      <div
        className="flex items-start gap-[14px] rounded-[14px] border px-[18px] py-4"
        style={{
          background: 'color-mix(in oklab, var(--color-private) 9%, transparent)',
          borderColor: 'color-mix(in oklab, var(--color-private) 30%, transparent)',
        }}
      >
        <ShieldCheck size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-private" />
        <div className="flex flex-col gap-1">
          <b className="text-[14px] font-semibold">{t('onboarding.mic.promiseTitle')}</b>
          <span className="text-pretty text-[13.5px] leading-[1.5] text-muted">{t('onboarding.mic.promise')}</span>
        </div>
      </div>
      {on ? (
        <div className="flex flex-col gap-3">
          {/* biome-ignore lint/a11y/useSemanticElements: a bar-graph level meter; <meter> cannot render it. */}
          <div
            role="meter"
            aria-label={t('onboarding.mic.level')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(p.micLevel * 100)}
            className="flex h-12 items-center gap-[3px] rounded-[12px] border border-border bg-surface-sunken px-4"
          >
            {hist.map((l, idx) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length rolling level history.
                key={idx}
                className="flex-1 rounded-[2px]"
                style={{
                  height: Math.max(3, Math.round(l * 36)),
                  background: l > 0.85 ? 'var(--color-ember)' : 'var(--color-accent)',
                  opacity: 0.35 + l * 0.65,
                }}
              />
            ))}
          </div>
          <span className="flex items-center gap-1.5 text-[13px] text-success">
            <CircleCheck size={14} aria-hidden="true" />
            {t('onboarding.mic.works')}
          </span>
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => setOn(true)}
            className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-[12px] border-0 bg-accent px-5 text-[14px] font-semibold text-accent-contrast"
          >
            <Mic size={16} aria-hidden="true" />
            {t('onboarding.mic.allow')}
          </button>
        </div>
      )}
    </div>
  );
}

function BrainCard({
  tile,
  title,
  sub,
  connected,
  primary,
  children,
  onPrimary,
}: {
  tile: ReactNode;
  title: string;
  sub: string;
  connected: boolean;
  primary: boolean;
  children?: ReactNode;
  onPrimary(): void;
}) {
  const t = useT();
  return (
    <div
      className="box-border flex min-h-[168px] flex-col gap-2 rounded-[14px] border p-4 transition-[border-color,background] duration-200"
      style={{
        background: connected
          ? 'color-mix(in oklab, var(--color-accent) 7%, var(--color-surface-raised))'
          : 'var(--color-surface-raised)',
        borderColor: primary ? 'var(--color-accent)' : 'var(--color-border)',
      }}
    >
      <div className="flex items-center gap-2.5">
        {tile}
        <span className="flex-1 text-[14px] font-semibold">{title}</span>
        {connected ? (
          <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-success">
            <CircleCheck size={12} aria-hidden="true" />
            {t('onboarding.brain.connected')}
          </span>
        ) : null}
      </div>
      <span className="text-pretty text-[12.5px] leading-[1.45] text-muted">{sub}</span>
      <span className="flex-1" />
      {children}
      {connected ? (
        <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted">
          <input
            type="radio"
            name="primary-brain"
            checked={primary}
            onChange={onPrimary}
            className="m-0"
            style={{ accentColor: 'var(--color-accent)' }}
          />
          {primary ? t('onboarding.brain.primary') : t('onboarding.brain.makePrimary')}
        </label>
      ) : null}
    </div>
  );
}

const cardBtn =
  'h-8 cursor-pointer rounded-[8px] border border-border-strong bg-surface-raised px-3 text-[12.5px] font-semibold whitespace-nowrap text-text';

function BrainStep(p: OnboardingProps) {
  const t = useT();
  const [key, setKey] = useState('');
  const get = (id: BrainId) => p.providers.find((x) => x.id === id);
  const chatgpt = get('chatgpt');
  const claude = get('claude');
  const apiConnected = get('api-anthropic')?.connected || get('api-openai')?.connected;
  const apiWhich = get('api-anthropic')?.connected ? 'Anthropic' : 'OpenAI';
  const local = get('local');
  const primary = p.primary ?? p.providers.find((x) => x.primary)?.id ?? null;
  const setPrimary = (id: BrainId) => p.onSetPrimary?.(id);
  const state = (label: string, color: string) => <span style={chipStyle(color)}>{label}</span>;

  return (
    <div className="flex flex-1 flex-col gap-4 pt-2">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-[24px] font-[650] tracking-[-0.02em]">{t('onboarding.brain.title')}</h2>
        <p className="m-0 text-[13.5px] text-muted">{t('onboarding.brain.sub')}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <BrainCard
          tile={<ProviderTile icon={MessageCircle} bg="oklch(0.6 0.1 160)" />}
          title={t('onboarding.brain.chatgpt')}
          sub={t('onboarding.brain.chatgpt.sub')}
          connected={!!chatgpt?.connected}
          primary={primary === 'chatgpt' && !!chatgpt?.connected}
          onPrimary={() => setPrimary('chatgpt')}
        >
          {chatgpt?.connected ? null : (
            // Reserved slot for the official "Sign in with ChatGPT" asset (280×44, neutral surroundings).
            <button
              type="button"
              onClick={p.onSignInChatGpt}
              aria-label={t('onboarding.brain.signInChatGpt')}
              className="grid h-11 w-[280px] max-w-full cursor-pointer place-items-center rounded-[10px] border-[1.5px] border-dashed border-border-strong bg-surface-sunken font-mono text-[11.5px] font-medium text-subtle"
            >
              {t('onboarding.brain.signInChatGpt')}
            </button>
          )}
        </BrainCard>
        <BrainCard
          tile={<ProviderTile icon={Terminal} bg="oklch(0.6 0.13 45)" />}
          title={t('onboarding.brain.claude')}
          sub={t('onboarding.brain.claude.sub')}
          connected={!!claude?.connected}
          primary={primary === 'claude' && !!claude?.connected}
          onPrimary={() => setPrimary('claude')}
        >
          <div className="flex items-center gap-2">
            {claude?.connected
              ? state(t('onboarding.brain.ready'), 'var(--color-success)')
              : claude?.state === 'needs-login'
                ? state(t('onboarding.brain.found'), 'var(--color-warning)')
                : state(t('onboarding.brain.claudeMissing'), 'var(--color-text-subtle)')}
            <span className="flex-1" />
            {claude?.connected ? null : (
              <button type="button" className={cardBtn} onClick={p.onUseClaude}>
                {t('onboarding.brain.signIn')}
              </button>
            )}
          </div>
        </BrainCard>
        <BrainCard
          tile={<ProviderTile icon={KeyRound} bg="oklch(0.5 0.04 260)" />}
          title={t('onboarding.brain.api')}
          sub={t('onboarding.brain.api.sub')}
          connected={!!apiConnected}
          primary={(primary === 'api-anthropic' || primary === 'api-openai') && !!apiConnected}
          onPrimary={() => setPrimary(get('api-anthropic')?.connected ? 'api-anthropic' : 'api-openai')}
        >
          {apiConnected ? (
            <div className="flex items-center gap-2">{state(apiWhich, 'var(--color-success)')}</div>
          ) : (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const v = key.trim();
                if (!v) return;
                // Sent to the OS keyring via secrets.set; never kept in UI state (R6).
                p.onSecret(v.startsWith('sk-ant-') ? 'anthropic-api-key' : 'openai-api-key', v);
                setKey('');
              }}
            >
              <span className="flex-1" />
              <input
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                aria-label={t('onboarding.brain.api.key')}
                placeholder="sk-…"
                className="h-8 w-[120px] min-w-0 flex-1 rounded-[8px] border border-border-strong bg-surface-sunken px-2.5 font-mono text-[12.5px] text-text outline-none focus:border-accent"
              />
              <button type="submit" className={cardBtn} disabled={!key.trim()}>
                {t('onboarding.brain.saveKey')}
              </button>
            </form>
          )}
        </BrainCard>
        <BrainCard
          tile={<ProviderTile icon={Cpu} bg="var(--color-private)" />}
          title={t('onboarding.brain.local')}
          sub={t('onboarding.brain.local.sub')}
          connected={!!local?.connected}
          primary={primary === 'local' && !!local?.connected}
          onPrimary={() => setPrimary('local')}
        >
          <div className="flex items-center gap-2">
            {local?.connected
              ? state(local.plan ?? t('onboarding.brain.detected'), 'var(--color-success)')
              : state(t('onboarding.brain.notFound'), 'var(--color-text-subtle)')}
            <span className="flex-1" />
            {local?.connected ? null : (
              <button type="button" className={cardBtn} onClick={p.onUseLocal}>
                {t('onboarding.brain.detect')}
              </button>
            )}
          </div>
        </BrainCard>
      </div>
    </div>
  );
}

const VOICES: { id: TtsId; name: MessageKey; sub: MessageKey; local?: boolean }[] = [
  { id: 'elevenlabs', name: 'tts.elevenlabs', sub: 'onboarding.voice.elevenlabs' },
  { id: 'fish', name: 'tts.fish', sub: 'onboarding.voice.fish' },
  { id: 'openai', name: 'tts.openai', sub: 'onboarding.voice.openai' },
  { id: 'piper', name: 'tts.piper', sub: 'onboarding.voice.piper', local: true },
  { id: 'system', name: 'tts.system', sub: 'onboarding.voice.system', local: true },
];

function VoiceStep(p: OnboardingProps) {
  const t = useT();
  const [playing, setPlaying] = useState<TtsId | null>(null);
  useEffect(() => {
    if (!playing) return;
    const id = setTimeout(() => setPlaying(null), 2400);
    return () => clearTimeout(id);
  }, [playing]);
  return (
    <div className="flex flex-1 flex-col gap-4 pt-2">
      <div className="flex items-end gap-4">
        <div className="flex flex-1 flex-col gap-1">
          <h2 className="m-0 text-[24px] font-[650] tracking-[-0.02em]">{t('onboarding.voice.title')}</h2>
          <p className="m-0 text-[13.5px] text-muted">{t('onboarding.voice.sub')}</p>
        </div>
        <Segmented
          size="lg"
          label={t('settings.language')}
          value={p.locale}
          onChange={p.onLocale}
          options={[
            { value: 'en', label: 'English' },
            { value: 'it', label: 'Italiano' },
          ]}
        />
      </div>
      <div role="radiogroup" aria-label={t('onboarding.voice.title')} className="flex flex-col gap-2">
        {VOICES.map((v) => {
          const on = p.tts === v.id;
          const isPlaying = playing === v.id;
          const style: CSSProperties = {
            background: on
              ? 'color-mix(in oklab, var(--color-accent) 8%, var(--color-surface-raised))'
              : 'var(--color-surface-raised)',
            borderColor: on ? 'var(--color-accent)' : 'var(--color-border)',
          };
          return (
            // biome-ignore lint/a11y/useSemanticElements: a selectable row that also contains a preview button.
            <div
              key={v.id}
              role="radio"
              aria-checked={on}
              tabIndex={0}
              onClick={() => p.onTts(v.id)}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  p.onTts(v.id);
                }
              }}
              className="flex h-14 cursor-pointer items-center gap-[14px] rounded-[12px] border py-0 pr-2.5 pl-4"
              style={style}
            >
              <span
                className="box-border h-4 w-4 shrink-0 rounded-pill"
                style={{ border: on ? '5px solid var(--color-accent)' : '1.5px solid var(--color-border-strong)' }}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="text-[14px] font-semibold">{t(v.name)}</span>
                <span className="text-[12.5px] text-muted">{t(v.sub)}</span>
              </div>
              {v.local ? (
                <span style={chipStyle('var(--color-private)', 20)} className="!px-[7px]">
                  <Lock size={10} aria-hidden="true" />
                  {t('onboarding.voice.onDevice')}
                </span>
              ) : null}
              <button
                type="button"
                aria-label={`${isPlaying ? t('onboarding.voice.stop') : t('onboarding.voice.preview')} ${t(v.name)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isPlaying) setPlaying(null);
                  else {
                    setPlaying(v.id);
                    p.onPreview(v.id);
                  }
                }}
                className="grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-pill border border-border-strong bg-surface-raised text-text"
              >
                {isPlaying ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CONFETTI = ['var(--color-accent)', 'var(--color-ember)', 'var(--color-private)', 'var(--color-text-muted)'];

function TryStep(p: OnboardingProps & { anim: boolean }) {
  const t = useT();
  const [phase, setPhase] = useState<'idle' | 'running' | 'spoke' | 'done'>('idle');
  const kind = p.pill.kind;
  useEffect(() => {
    if (phase === 'running' && kind === 'speaking') setPhase('spoke');
    if (phase === 'spoke' && kind !== 'speaking') setPhase('done');
  }, [kind, phase]);
  const utterance = t('onboarding.try.utterance');
  const pill: PillState =
    kind === 'hidden'
      ? { kind: 'idle-hint', shortcut: p.platform === 'mac' ? ['⌥', 'Space'] : ['Alt', 'Space'] }
      : p.pill;
  const done = phase === 'done';
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-7 text-center">
      <div className="flex flex-col items-center gap-2">
        <h2 className="m-0 text-[26px] font-[650] tracking-[-0.02em]">{t('onboarding.try.title')}</h2>
        <p className="m-0 text-[15px] text-muted">
          {t('onboarding.try.say')} <em className="font-semibold text-text">“{utterance}”</em>
        </p>
      </div>
      <div className="relative grid h-16 place-items-center">
        <ListeningPill state={pill} privateMode={p.privateMode} platform={p.platform} />
        {done && p.anim
          ? Array.from({ length: 14 }, (_, idx) => {
              const a = (idx / 14) * Math.PI * 2;
              return (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative burst.
                  key={idx}
                  className="pointer-events-none absolute top-1/2 left-1/2 h-1.5 w-1.5"
                  style={
                    {
                      borderRadius: idx % 2 ? 2 : 999,
                      background: CONFETTI[idx % 4],
                      '--dx': `${Math.round(Math.cos(a) * 220)}px`,
                      '--dy': `${Math.round(Math.sin(a) * 70)}px`,
                      animation: `jv-confetti 900ms var(--ease-standard) ${idx * 18}ms both`,
                    } as CSSProperties
                  }
                />
              );
            })
          : null}
      </div>
      {done ? (
        <span role="status" className="flex items-center gap-1.5 text-[14px] font-semibold text-success">
          <PartyPopper size={16} aria-hidden="true" />
          {t('onboarding.try.ok')}
        </span>
      ) : null}
      {phase === 'idle' || done ? (
        <button
          type="button"
          onClick={() => {
            setPhase('running');
            p.onTry?.(utterance);
          }}
          className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[10px] border border-border-strong bg-surface-raised px-[14px] text-[13px] font-medium text-text"
        >
          <Mic size={14} aria-hidden="true" />
          {t('onboarding.try.simulate')}
        </button>
      ) : null}
    </div>
  );
}
