/** S5 — Settings (handoff `Settings.dc.html`). Data in via props, changes out via `onPatch` / callbacks. */
import { type Project, SETTINGS_TABS, type Settings as SettingsData, type SettingsTab } from '@jarvis/core';
import {
  AppWindow,
  AudioLines,
  Brain,
  Check,
  CircleCheck,
  CircleDashed,
  CircleX,
  Copy,
  Download,
  FolderKanban,
  Info,
  Keyboard,
  LoaderCircle,
  Lock,
  LogIn,
  type LucideIcon,
  Mic,
  OctagonAlert,
  Play,
  Plug,
  RadioTower,
  Settings2,
  Shield,
  ShieldCheck,
  Smartphone,
  Terminal,
  Trash2,
  Wallet,
  WifiOff,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { type MessageKey, useT } from '../../i18n';
import { cn } from '../../lib/cn';
import type {
  BrainId,
  ModelStatus,
  PermissionLevel,
  Platform,
  ProviderStatus,
  RelayState,
  SecretKey,
} from '../../types/ui';
import {
  brainKey,
  LinuxCaption,
  MacLights,
  ProviderTile,
  Segmented,
  StatusChip,
  Switch,
  UsageBar,
  usageColor,
  WinCaption,
  type WindowAction,
} from '../common/common';
import { WindowFrame } from '../common/WindowFrame';
import { Orb } from '../orb/Orb';
import {
  fieldClass,
  outlineBtn,
  PairingQR,
  PermissionLevelControl,
  primaryBtn,
  Row,
  Section,
  ShortcutRow,
} from './controls';

export type { SecretKey };

export interface VoiceInfo {
  id: string;
  name: string;
  locale?: string;
  tags?: string[];
}

type TtsId = SettingsData['tts'];

export interface SettingsProps {
  platform: Platform;
  tab: SettingsTab;
  settings: SettingsData;
  providers: ProviderStatus[];
  projects: Project[];
  relay: RelayState;
  models: ModelStatus[];
  micLevel: number;
  version: string;
  shortcutConflicts: string[];
  /** Toasts rendered inside the window card. */
  overlay?: ReactNode;
  onTabChange(tab: SettingsTab): void;
  onPatch(patch: Partial<SettingsData>): void;
  onSetPrimary(b: BrainId): void;
  onSignIn(p: 'chatgpt'): void;
  onSignOut(p: 'chatgpt'): void;
  onSecret(key: SecretKey, value: string): void;
  onDeleteSecret(key: SecretKey): void;
  onProjectPermission(project: Project, level: PermissionLevel): void;
  onTtsPreview(provider: TtsId, voiceId?: string): void;
  /** Voices a provider offers and whether it is ready to speak (key entered / voice downloaded). */
  onLoadVoices(provider: TtsId): Promise<{ voices: VoiceInfo[]; configured: boolean }>;
  /** Opens a project page in the system browser. */
  onOpenUrl(url: string): void;
  onDownloadModels(): void;
  onMicMonitor(enabled: boolean): void;
  onPair(relayUrl: string): void;
  onUnpair(): void;
  onClearHistory(scope: 'today' | 'all'): void;
  onClearMemory(): void;
  onCopy(text: string): void;
  onWindow(action: WindowAction): void;
}

const TAB_ICON: Record<SettingsTab, LucideIcon> = {
  general: Settings2,
  brain: Brain,
  agents: FolderKanban,
  voice: AudioLines,
  microphone: Mic,
  privacy: Shield,
  integrations: Plug,
  shortcuts: Keyboard,
  about: Info,
};

const HUES: [number, string][] = [
  [200, 'Arc'],
  [255, 'Indigo'],
  [165, 'Teal'],
  [300, 'Violet'],
  [25, 'Coral'],
];

export function Settings(p: SettingsProps) {
  const t = useT();
  return (
    <WindowFrame platform={p.platform} width={820} height={600}>
      <div data-tauri-drag-region className="flex h-11 shrink-0 items-center gap-2 border-b border-border pl-[14px]">
        {p.platform === 'mac' ? (
          <div className="mr-2">
            <MacLights onAction={p.onWindow} />
          </div>
        ) : null}
        <span data-tauri-drag-region className="text-[13px] font-semibold text-muted">
          {t('settings.title')}
        </span>
        <span data-tauri-drag-region className="flex-1 self-stretch" />
        {p.platform === 'win' ? <WinCaption onAction={p.onWindow} maximize={false} /> : null}
        {p.platform === 'linux' ? <LinuxCaption onAction={p.onWindow} /> : null}
      </div>
      <div className="flex min-h-0 flex-1">
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label={t('settings.title')}
          className="scroll-y flex w-[232px] shrink-0 flex-col gap-0.5 bg-surface-sunken px-2.5 py-3"
        >
          {SETTINGS_TABS.map((tab) => {
            const on = p.tab === tab;
            const I = TAB_ICON[tab];
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={on}
                aria-current={on ? 'page' : undefined}
                onClick={() => p.onTabChange(tab)}
                className={cn(
                  'flex h-[34px] cursor-pointer items-center gap-2.5 rounded-[8px] border-0 px-2.5 text-left text-[13px] hover:bg-surface-raised hover:text-text',
                  on ? 'bg-surface-raised font-semibold text-text shadow-sm' : 'bg-transparent font-medium text-muted',
                )}
              >
                <I size={16} aria-hidden="true" className="w-[18px] shrink-0" />
                <span className="truncate">{t(`settings.tab.${tab}` as MessageKey)}</span>
              </button>
            );
          })}
          <p className="m-0 mt-auto flex items-start gap-1.5 px-2.5 pt-3 text-[11.5px] leading-[1.4] text-muted">
            <Check size={13} aria-hidden="true" className="mt-px shrink-0" />
            {t('settings.autosave')}
          </p>
        </div>
        <main role="tabpanel" className="scroll-y flex min-w-0 flex-1 flex-col gap-7 px-7 pt-6 pb-8">
          <h1 className="m-0 text-[20px] font-[650] tracking-[-0.02em]">{t(`settings.tab.${p.tab}` as MessageKey)}</h1>
          <TabBody {...p} />
        </main>
      </div>
      {p.overlay}
    </WindowFrame>
  );
}

function SecretRow({
  secretKey,
  label,
  onSave,
  onDelete,
}: {
  secretKey: SecretKey;
  label: string;
  onSave(k: SecretKey, v: string): void;
  onDelete(k: SecretKey): void;
}) {
  const t = useT();
  const [value, setValue] = useState('');
  return (
    <Row label={label} desc={t('secret.hint')}>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim()) return;
          onSave(secretKey, value.trim());
          setValue(''); // never kept in UI state or storage after sending (R6)
        }}
      >
        <input
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={label}
          placeholder="sk-…"
          className={cn(fieldClass, 'w-48 bg-surface-sunken font-mono text-[12.5px]')}
        />
        <button type="submit" className={primaryBtn} disabled={!value.trim()}>
          {t('common.save')}
        </button>
        <button
          type="button"
          aria-label={t('secret.delete')}
          title={t('secret.delete')}
          onClick={() => onDelete(secretKey)}
          className="grid h-8 w-8 cursor-pointer place-items-center rounded-[8px] border-0 bg-transparent text-muted hover:bg-surface-raised hover:text-text"
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </form>
    </Row>
  );
}

function Select<V extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: V;
  options: { value: V; label: string }[];
  onChange(v: V): void;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as V)}
      className={cn(fieldClass, 'min-w-[180px] cursor-pointer')}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function TextField({
  label,
  value,
  onCommit,
  type = 'text',
  className,
  min,
  max,
  mono,
}: {
  label: string;
  value: string | number;
  onCommit(v: string): void;
  type?: 'text' | 'number';
  className?: string;
  min?: number;
  max?: number;
  mono?: boolean;
}) {
  return (
    <input
      type={type}
      aria-label={label}
      defaultValue={value}
      min={min}
      max={max}
      onBlur={(e) => onCommit(e.target.value)}
      className={cn(fieldClass, mono && 'font-mono text-[12.5px]', className)}
    />
  );
}

export function LevelMeter({ level, label }: { level: number; label: string }) {
  const lit = Math.round(Math.max(0, Math.min(1, level)) * 20);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a bar-graph level meter; <meter> cannot render it.
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
      className="flex h-6 w-[180px] items-center gap-0.5"
    >
      {Array.from({ length: 20 }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length meter.
          key={i}
          className="h-full flex-1 rounded-[2px]"
          style={{
            background: i < lit ? 'var(--color-accent)' : 'var(--color-border-strong)',
            opacity: i < lit ? 0.5 + i * 0.05 : 1,
          }}
        />
      ))}
    </div>
  );
}

export function ModelList({ models, onDownload }: { models: ModelStatus[]; onDownload(): void }) {
  const t = useT();
  const missing = models.some((m) => m.state === 'missing' || m.state === 'error');
  return (
    <>
      {models.length === 0 ? <Row label={t('models.unavailable')} /> : null}
      {models.map((m) => (
        <Row key={m.id} label={m.label} note={m.error} noteColor="var(--color-danger)" noteIcon={CircleX}>
          <div className="flex w-[180px] flex-col items-end gap-1.5">
            <span
              className="text-[12px] font-semibold"
              style={{
                color:
                  m.state === 'ready'
                    ? 'var(--color-success)'
                    : m.state === 'error'
                      ? 'var(--color-danger)'
                      : 'var(--color-text-subtle)',
              }}
            >
              {t(`models.state.${m.state}` as MessageKey)}
            </span>
            {m.state === 'downloading' && m.total > 0 ? (
              <UsageBar pct={(m.received / m.total) * 100} label={m.label} width={180} />
            ) : null}
          </div>
        </Row>
      ))}
      {missing ? (
        <div className="pt-3">
          <button type="button" className={primaryBtn} onClick={onDownload}>
            <Download size={13} aria-hidden="true" />
            {t('models.download')}
          </button>
        </div>
      ) : null}
    </>
  );
}

const STATE_COLOR: Record<ProviderStatus['state'], string> = {
  ok: 'var(--color-success)',
  'needs-login': 'var(--color-warning)',
  'cap-reached': 'var(--color-danger)',
  error: 'var(--color-danger)',
  'not-installed': 'var(--color-text-subtle)',
};
const STATE_ICON: Record<ProviderStatus['state'], LucideIcon> = {
  ok: CircleCheck,
  'needs-login': LogIn,
  'cap-reached': OctagonAlert,
  error: CircleX,
  'not-installed': CircleDashed,
};

function AccountCard({ pr, p }: { pr: ProviderStatus; p: SettingsProps }) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const name = t(brainKey(pr.id));
  const connected = pr.state === 'ok' || pr.state === 'cap-reached' || pr.connected;
  const secret: SecretKey | null =
    pr.id === 'api-anthropic' ? 'anthropic-api-key' : pr.id === 'api-openai' ? 'openai-api-key' : null;
  const line =
    pr.id === 'local'
      ? `${p.settings.localBrain.model} · ${t('settings.onDevice')}`
      : [pr.account, pr.plan].filter(Boolean).join(' · ') || '—';
  const btnBase = 'h-[30px] cursor-pointer rounded-[8px] px-2.5 text-[12px] font-semibold whitespace-nowrap';
  const ghost = cn(btnBase, 'border-0 bg-transparent text-muted hover:text-text');
  const solid = cn(btnBase, 'border border-border-strong bg-surface-raised text-text');
  let action: ReactNode = null;
  if (pr.id === 'chatgpt')
    action = connected ? (
      <button type="button" className={ghost} onClick={() => p.onSignOut('chatgpt')}>
        {t('settings.disconnect')}
      </button>
    ) : (
      <button type="button" className={solid} onClick={() => p.onSignIn('chatgpt')}>
        {t('settings.signIn')}
      </button>
    );
  else if (secret)
    action = connected ? (
      <button type="button" className={ghost} onClick={() => p.onDeleteSecret(secret)}>
        {t('settings.disconnect')}
      </button>
    ) : (
      <button type="button" className={solid} aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
        {t('settings.addKey')}
      </button>
    );
  const makePrimary =
    connected && !pr.primary ? (
      <button type="button" className={ghost} onClick={() => p.onSetPrimary(pr.id)}>
        {t('settings.makePrimary')}
      </button>
    ) : null;
  const pct = pr.usagePct;
  const usageLabel = `${pr.plan ?? name} · ${t('settings.usage')}`;
  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] border border-border bg-surface-raised px-4 py-[14px]">
      <div className="flex items-center gap-3">
        <ProviderTile id={pr.id} />
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="flex items-center gap-2 text-[14px] font-semibold">
            {name}
            {pr.primary ? (
              <span className="inline-flex h-[18px] items-center rounded-pill bg-accent-soft px-[7px] text-[10.5px] font-semibold text-text">
                {t('settings.primary')}
              </span>
            ) : null}
          </span>
          <span className="truncate text-[12.5px] text-muted">{line}</span>
        </div>
        <StatusChip color={STATE_COLOR[pr.state]} icon={STATE_ICON[pr.state]}>
          {t(`provider.state.${pr.state}` as MessageKey)}
        </StatusChip>
        {makePrimary}
        {action}
      </div>
      {pct !== undefined && connected ? (
        <div className="flex flex-col gap-1.5 pl-11">
          <div className="flex justify-between text-[12px] text-muted">
            <span>{usageLabel}</span>
            <span className="tabular font-semibold" style={{ color: usageColor(pct) }}>
              {Math.round(pct)}%
            </span>
          </div>
          <UsageBar pct={pct} label={usageLabel} />
          {pct >= 100 ? (
            <span className="flex items-center gap-1.5 text-[12px] text-danger">
              <OctagonAlert size={13} aria-hidden="true" />
              {t('usage.capReached')}
            </span>
          ) : null}
        </div>
      ) : null}
      {adding && secret ? (
        <div className="pl-11 [&>.row]:border-t-0 [&>.row]:py-0">
          <SecretRow
            secretKey={secret}
            label={t(pr.id === 'api-anthropic' ? 'secret.anthropic' : 'secret.openai')}
            onSave={(k, v) => {
              p.onSecret(k, v);
              setAdding(false);
            }}
            onDelete={p.onDeleteSecret}
          />
        </div>
      ) : null}
    </div>
  );
}

function TabBody(p: SettingsProps) {
  const t = useT();
  const s = p.settings;
  const sw = (key: keyof SettingsData, label: MessageKey, desc?: MessageKey) => (
    <Row label={t(label)} desc={desc ? t(desc) : undefined}>
      <Switch
        checked={Boolean(s[key])}
        onCheckedChange={(v) => p.onPatch({ [key]: v } as Partial<SettingsData>)}
        label={t(label)}
      />
    </Row>
  );

  switch (p.tab) {
    case 'general':
      return (
        <>
          <Section title={t('settings.appearance')}>
            <Row label={t('settings.theme')} desc={t('settings.theme.desc')}>
              <Segmented
                label={t('settings.theme')}
                value={s.theme}
                onChange={(theme) => p.onPatch({ theme })}
                options={(['dark', 'light', 'system'] as const).map((v) => ({
                  value: v,
                  label: t(`settings.theme.${v}` as MessageKey),
                }))}
              />
            </Row>
            <Row label={t('settings.material')} desc={t('settings.material.desc')}>
              <Segmented
                label={t('settings.material')}
                value={s.material === 'auto' ? null : s.material}
                onChange={(material) => p.onPatch({ material })}
                options={(['glass', 'solid'] as const).map((v) => ({
                  value: v,
                  label: t(`settings.material.${v}` as MessageKey),
                }))}
              />
            </Row>
            <Row label={t('settings.accent')} desc={t('settings.accent.desc')}>
              <div role="radiogroup" aria-label={t('settings.accent')} className="flex gap-2">
                {HUES.map(([h, name]) => {
                  const on = Math.round(s.accentHue) === h;
                  return (
                    // biome-ignore lint/a11y/useSemanticElements: colour swatch radio (role=radio inside role=radiogroup).
                    <button
                      key={h}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={name}
                      title={name}
                      onClick={() => p.onPatch({ accentHue: h })}
                      className="h-[26px] w-[26px] cursor-pointer rounded-pill border-0"
                      style={{
                        background: `oklch(0.7 0.14 ${h})`,
                        boxShadow: on ? '0 0 0 2px var(--color-surface), 0 0 0 4px var(--color-text)' : 'none',
                      }}
                    />
                  );
                })}
              </div>
            </Row>
          </Section>
          <Section title={t('settings.behaviour')}>
            <Row label={t('settings.name')}>
              <TextField
                label={t('settings.name')}
                value={s.userName}
                onCommit={(userName) => p.onPatch({ userName: userName.slice(0, 80) })}
                className="w-[180px]"
              />
            </Row>
            <Row label={t('settings.language')} desc={t('settings.language.desc')}>
              <Segmented
                label={t('settings.language')}
                value={s.locale}
                onChange={(locale) => p.onPatch({ locale })}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'it', label: 'Italiano' },
                ]}
              />
            </Row>
            {sw('launchAtLogin', 'settings.launchAtLogin')}
          </Section>
        </>
      );
    case 'brain':
      return (
        <>
          <div className="flex flex-col gap-2">
            {p.providers.map((pr) => (
              <AccountCard key={pr.id} pr={pr} p={p} />
            ))}
          </div>
          <Section>
            <Row label={t('settings.noPaidFallback')} desc={t('settings.noPaidFallback.desc')} icon={Wallet}>
              {/* Golden rule 4: never silently fall back to a paid API. Always on. */}
              <Switch checked onCheckedChange={() => {}} label={t('settings.noPaidFallback')} disabled />
            </Row>
          </Section>
          <Section title={t('settings.local')}>
            <Row label={t('settings.local.url')}>
              <TextField
                label={t('settings.local.url')}
                value={s.localBrain.baseUrl}
                mono
                className="w-64"
                onCommit={(baseUrl) => p.onPatch({ localBrain: { ...s.localBrain, baseUrl } })}
              />
            </Row>
            <Row label={t('settings.local.model')}>
              <TextField
                label={t('settings.local.model')}
                value={s.localBrain.model}
                mono
                className="w-64"
                onCommit={(model) => p.onPatch({ localBrain: { ...s.localBrain, model } })}
              />
            </Row>
          </Section>
        </>
      );
    case 'agents':
      return (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <span className="flex-1 text-[12px] font-semibold tracking-[.06em] text-subtle uppercase">
                {t('settings.projects')}
              </span>
            </div>
            {p.projects.length === 0 ? (
              <p className="m-0 text-[12.5px] text-subtle">{t('settings.projects.empty')}</p>
            ) : null}
            {p.projects.map((pr) => (
              <div
                key={pr.id}
                className="flex flex-wrap items-center gap-[14px] rounded-[14px] border border-border bg-surface-raised px-4 py-[14px]"
              >
                <div className="flex min-w-[180px] flex-1 flex-col gap-0.5">
                  <span className="text-[14px] font-semibold">{pr.name}</span>
                  <span className="font-mono text-[11.5px] text-subtle">{pr.path}</span>
                  <span className="text-[12px] text-muted">{t(`agent.${pr.defaultAgent}` as MessageKey)}</span>
                </div>
                <PermissionLevelControl
                  value={pr.permission}
                  project={pr.name}
                  label={t('permission.label', { project: pr.name })}
                  onChange={(lvl) => p.onProjectPermission(pr, lvl)}
                />
              </div>
            ))}
            <p className="text-pretty m-0 mt-1 text-[12.5px] leading-[1.5] text-muted">{t('permission.help')}</p>
          </div>
          <Section>
            <Row label={t('settings.defaultAgent')} desc={t('settings.defaultAgent.desc')}>
              <Segmented
                label={t('settings.defaultAgent')}
                value={s.defaultAgent}
                onChange={(defaultAgent) => p.onPatch({ defaultAgent })}
                options={(['claude', 'codex', 'home'] as const).map((v) => ({
                  value: v,
                  label: t(`agent.${v}` as MessageKey),
                }))}
              />
            </Row>
            <Row label={t('settings.maxSessions')}>
              <TextField
                type="number"
                min={1}
                max={12}
                label={t('settings.maxSessions')}
                value={s.maxConcurrentSessions}
                className="w-20"
                onCommit={(v) => p.onPatch({ maxConcurrentSessions: Math.max(1, Math.min(12, Number(v) || 1)) })}
              />
            </Row>
          </Section>
        </>
      );
    case 'voice':
      return (
        <>
          <Section>
            <VoiceProviderRows {...p} />
            <Row label={t('settings.rate')}>
              <div className="flex items-center gap-2.5">
                <input
                  type="range"
                  aria-label={t('settings.rate')}
                  min={0.5}
                  max={2}
                  step={0.05}
                  defaultValue={s.speakingRate}
                  onChange={(e) => p.onPatch({ speakingRate: Number(e.target.value) })}
                  className="w-40"
                  style={{ accentColor: 'var(--color-accent)' }}
                />
                <span className="tabular w-10 text-right text-[12.5px] text-muted">{s.speakingRate.toFixed(2)}×</span>
              </div>
            </Row>
            {sw('speakReplies', 'settings.speakReplies', 'settings.speakReplies.desc')}
            {sw('speakProgress', 'settings.speakProgress')}
            {sw('speakSummaries', 'settings.speakSummaries')}
            {sw('muteDuringFocus', 'settings.muteDuringFocus')}
          </Section>
          <Section title={t('settings.apiKeys')}>
            <SecretRow
              secretKey="elevenlabs-api-key"
              label={t('secret.elevenlabs')}
              onSave={p.onSecret}
              onDelete={p.onDeleteSecret}
            />
            <SecretRow
              secretKey="fish-audio-api-key"
              label={t('secret.fish')}
              onSave={p.onSecret}
              onDelete={p.onDeleteSecret}
            />
          </Section>
        </>
      );
    case 'microphone':
      return <MicrophoneTab {...p} />;
    case 'privacy': {
      const retention = s.historyRetentionDays;
      const retentionId =
        retention === 1 ? 'd1' : retention === 7 ? 'd7' : retention === 30 ? 'd30' : retention === 0 ? 'forever' : null;
      return (
        <>
          <Section>
            <Row
              label={t('settings.privateMode')}
              desc={t('settings.privateMode.hint')}
              icon={ShieldCheck}
              iconColor="var(--color-private)"
              note={s.privateMode ? t('settings.privateMode.note') : undefined}
              noteColor="var(--color-private)"
              className="rounded-[14px] px-4 py-[14px]"
              style={{
                borderWidth: 1,
                borderStyle: 'solid',
                background: s.privateMode
                  ? 'color-mix(in oklab, var(--color-private) 10%, transparent)'
                  : 'var(--color-surface-raised)',
                borderColor: s.privateMode
                  ? 'color-mix(in oklab, var(--color-private) 40%, transparent)'
                  : 'var(--color-border)',
              }}
            >
              <Switch
                green
                checked={s.privateMode}
                onCheckedChange={(privateMode) => p.onPatch({ privateMode })}
                label={t('settings.privateMode')}
              />
            </Row>
          </Section>
          <Section>
            <Row label={t('settings.retention')}>
              <Segmented
                label={t('settings.retention')}
                value={retentionId}
                onChange={(v) => p.onPatch({ historyRetentionDays: { d1: 1, d7: 7, d30: 30, forever: 0 }[v] })}
                options={(['d1', 'd7', 'd30', 'forever'] as const).map((v) => ({
                  value: v,
                  label: t(`settings.retention.${v}` as MessageKey),
                }))}
              />
            </Row>
            {sw('openResults', 'settings.openResults')}
            {sw('screenAccess', 'settings.screenAccess', 'settings.screenAccess.desc')}
          </Section>
          <Section title={t('settings.danger')} danger>
            <Row label={t('settings.deleteToday')} desc={t('settings.deleteToday.desc')}>
              <button type="button" className={outlineBtn(true)} onClick={() => p.onClearHistory('today')}>
                {t('common.delete')}
              </button>
            </Row>
            <Row label={t('settings.deleteAll')} desc={t('settings.deleteAll.desc')}>
              <button type="button" className={outlineBtn(true)} onClick={() => p.onClearHistory('all')}>
                {t('common.delete')}
              </button>
            </Row>
            <Row label={t('settings.clearMemory')} desc={t('settings.clearMemory.desc')}>
              <button type="button" className={outlineBtn(true)} onClick={p.onClearMemory}>
                {t('common.delete')}
              </button>
            </Row>
          </Section>
        </>
      );
    }
    case 'integrations':
      return <IntegrationsTab {...p} />;
    case 'shortcuts':
      return (
        <Section>
          <ShortcutRow
            label={t('shortcut.pushToTalk')}
            desc={t('shortcut.pushToTalk.hint')}
            value={s.pushToTalk}
            platform={p.platform}
            conflict={p.shortcutConflicts.includes(s.pushToTalk)}
            onChange={(pushToTalk) => p.onPatch({ pushToTalk })}
          />
          <ShortcutRow
            label={t('shortcut.toggleSessions')}
            value={s.toggleSessions}
            platform={p.platform}
            conflict={p.shortcutConflicts.includes(s.toggleSessions)}
            onChange={(toggleSessions) => p.onPatch({ toggleSessions })}
          />
          <Row label={t('shortcut.stop')}>
            <span className="flex min-w-[120px] justify-end px-2">
              <kbd className="kbd">Esc</kbd>
            </span>
          </Row>
        </Section>
      );
    case 'about':
      return (
        <div className="flex flex-col items-start gap-5">
          <div className="flex items-center gap-4">
            <Orb size={64} state="idle" />
            <div className="flex flex-col gap-0.5">
              <span className="text-[28px] font-[650] tracking-[-0.03em]">Jarvis</span>
              <span className="tabular text-[13px] text-muted">
                {t('about.version')} {p.version || '—'} · Tauri 2 · React 19
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => p.onOpenUrl('https://github.com/lopadova/jarvis-desktop/releases')}
              className="inline-flex h-9 cursor-pointer items-center rounded-[10px] border-0 bg-accent px-[14px] text-[13px] font-semibold text-accent-contrast"
            >
              {t('about.notes')}
            </button>
            <button
              type="button"
              onClick={() => p.onOpenUrl('https://github.com/lopadova/jarvis-desktop')}
              className="inline-flex h-9 cursor-pointer items-center rounded-[10px] border border-border-strong bg-surface-raised px-[14px] text-[13px] font-semibold text-text"
            >
              {t('about.source')}
            </button>
            <span className="inline-flex h-9 items-center px-[14px] text-[13px] font-medium text-muted">
              {t('about.license')} · MIT
            </span>
          </div>
          <p className="text-pretty m-0 max-w-[460px] text-[13px] leading-[1.55] text-muted">{t('about.text')}</p>
        </div>
      );
    default:
      return null;
  }
}

const ELEVENLABS_MODELS = [
  { value: 'eleven_v3', label: 'Eleven v3 (expressive)' },
  { value: 'eleven_flash_v2_5', label: 'Flash v2.5 (fastest)' },
  { value: 'eleven_multilingual_v2', label: 'Multilingual v2' },
];

function VoiceProviderRows(p: SettingsProps) {
  const t = useT();
  const s = p.settings;
  const [info, setInfo] = useState<{ voices: VoiceInfo[]; configured: boolean } | null>(null);
  const load = useRef(p.onLoadVoices);
  load.current = p.onLoadVoices;
  useEffect(() => {
    let alive = true;
    setInfo(null);
    load
      .current(s.tts)
      .then((r) => alive && setInfo(r))
      .catch(() => alive && setInfo({ voices: [], configured: false }));
    return () => {
      alive = false;
    };
  }, [s.tts]);

  const voiceId = s.ttsVoice[s.tts] ?? '';
  const ready = info?.configured !== false;
  const setVoice = (v: string) => {
    const next = { ...s.ttsVoice };
    if (v) next[s.tts] = v;
    else delete next[s.tts];
    p.onPatch({ ttsVoice: next });
  };
  return (
    <>
      <Row label={t('settings.tts')}>
        <div className="flex items-center gap-2">
          <Select
            label={t('settings.tts')}
            value={s.tts}
            onChange={(tts) => p.onPatch({ tts })}
            options={(['elevenlabs', 'fish', 'openai', 'kokoro', 'piper', 'system'] as const).map((v) => ({
              value: v,
              label: t(`tts.${v}` as MessageKey),
            }))}
          />
          <button
            type="button"
            aria-label={t('voice.preview')}
            title={t('voice.preview')}
            onClick={() => p.onTtsPreview(s.tts, voiceId || undefined)}
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-pill border border-border-strong bg-surface-raised text-text"
          >
            <Play size={13} aria-hidden="true" />
          </button>
        </div>
      </Row>
      {info ? (
        <Row label={t('voice.status')} desc={t(`voice.hint.${s.tts}` as MessageKey)}>
          <StatusChip
            color={ready ? 'var(--color-success)' : 'var(--color-warning)'}
            icon={ready ? CircleCheck : OctagonAlert}
          >
            {t(ready ? 'voice.ready' : 'voice.needsSetup')}
          </StatusChip>
        </Row>
      ) : null}
      {info && info.voices.length > 0 ? (
        <Row label={t('voice.voice')}>
          <Select
            label={t('voice.voice')}
            value={voiceId}
            onChange={setVoice}
            options={[
              { value: '', label: t('voice.default') },
              ...info.voices.map((v) => ({ value: v.id, label: v.locale ? `${v.name} · ${v.locale}` : v.name })),
            ]}
          />
        </Row>
      ) : null}
      {s.tts === 'elevenlabs' ? (
        <Row label={t('voice.model')}>
          <Select
            label={t('voice.model')}
            value={s.elevenlabsModel}
            onChange={(elevenlabsModel) => p.onPatch({ elevenlabsModel })}
            options={ELEVENLABS_MODELS as { value: SettingsData['elevenlabsModel']; label: string }[]}
          />
        </Row>
      ) : null}
      {s.tts === 'elevenlabs' ? (
        <>
          <VoiceSlider
            label={t('voice.stability')}
            desc={t('voice.stability.hint')}
            value={s.elevenlabsVoice.stability}
            onChange={(stability) => p.onPatch({ elevenlabsVoice: { ...s.elevenlabsVoice, stability } })}
          />
          <VoiceSlider
            label={t('voice.similarity')}
            desc={t('voice.similarity.hint')}
            value={s.elevenlabsVoice.similarityBoost}
            onChange={(similarityBoost) => p.onPatch({ elevenlabsVoice: { ...s.elevenlabsVoice, similarityBoost } })}
          />
          <VoiceSlider
            label={t('voice.style')}
            desc={t('voice.style.hint')}
            value={s.elevenlabsVoice.style}
            onChange={(style) => p.onPatch({ elevenlabsVoice: { ...s.elevenlabsVoice, style } })}
          />
          <Row label={t('voice.speakerBoost')} desc={t('voice.speakerBoost.hint')}>
            <Switch
              checked={s.elevenlabsVoice.speakerBoost}
              onCheckedChange={(speakerBoost) => p.onPatch({ elevenlabsVoice: { ...s.elevenlabsVoice, speakerBoost } })}
              label={t('voice.speakerBoost')}
            />
          </Row>
        </>
      ) : null}
      {s.tts === 'fish' ? (
        <Row label={t('voice.model')}>
          <input
            aria-label={t('voice.model')}
            defaultValue={s.fishModel}
            onBlur={(e) => e.target.value.trim() && p.onPatch({ fishModel: e.target.value.trim() })}
            className={cn(fieldClass, 'w-[180px] font-mono text-[12.5px]')}
          />
        </Row>
      ) : null}
    </>
  );
}

function VoiceSlider({
  label,
  desc,
  value,
  onChange,
}: {
  label: string;
  desc: string;
  value: number;
  onChange(v: number): void;
}) {
  return (
    <Row label={label} desc={desc}>
      <div className="flex items-center gap-2.5">
        <input
          type="range"
          aria-label={label}
          min={0}
          max={1}
          step={0.05}
          defaultValue={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-40"
          style={{ accentColor: 'var(--color-accent)' }}
        />
        <span className="tabular w-10 text-right text-[12.5px] text-muted">{value.toFixed(2)}</span>
      </div>
    </Row>
  );
}

function MicrophoneTab(p: SettingsProps) {
  const t = useT();
  const s = p.settings;
  const [monitoring, setMonitoring] = useState(false);
  const toggle = () => {
    p.onMicMonitor(!monitoring);
    setMonitoring((m) => !m);
  };
  const sw = (key: keyof SettingsData, label: MessageKey, desc?: MessageKey) => (
    <Row label={t(label)} desc={desc ? t(desc) : undefined}>
      <Switch
        checked={Boolean(s[key])}
        onCheckedChange={(v) => p.onPatch({ [key]: v } as Partial<SettingsData>)}
        label={t(label)}
      />
    </Row>
  );
  return (
    <>
      <Section>
        <Row label={t('settings.micTest')}>
          <div className="flex items-center gap-2.5">
            <LevelMeter level={monitoring ? p.micLevel : 0} label={t('settings.micTest')} />
            <button type="button" className={outlineBtn()} onClick={toggle} aria-pressed={monitoring}>
              {monitoring ? t('common.stop') : t('common.test')}
            </button>
          </div>
        </Row>
        <Row
          label={t('settings.stt')}
          desc={s.stt === 'local-whisper' ? t('settings.stt.local') : t('settings.stt.cloud')}
        >
          <Select
            label={t('settings.stt')}
            value={s.stt}
            onChange={(stt) => p.onPatch({ stt })}
            options={(['local-whisper', 'openai', 'elevenlabs'] as const).map((v) => ({
              value: v,
              label: t(`stt.${v}` as MessageKey),
            }))}
          />
        </Row>
        <Row label={t('settings.whisperModel')}>
          <Select
            label={t('settings.whisperModel')}
            value={s.whisperModel}
            onChange={(whisperModel) => p.onPatch({ whisperModel })}
            options={(['tiny', 'base', 'small', 'medium', 'large-v3-turbo'] as const).map((v) => ({
              value: v,
              label: v,
            }))}
          />
        </Row>
      </Section>
      <Section title={t('settings.wake')}>
        <Row
          label={t('settings.wakeWord')}
          desc={t('settings.wakeWord.desc')}
          icon={Lock}
          iconColor="var(--color-private)"
        >
          <Switch
            checked={s.wakeWord}
            onCheckedChange={(wakeWord) => p.onPatch({ wakeWord })}
            label={t('settings.wakeWord')}
          />
        </Row>
        {sw('wakeOnClap', 'settings.wakeOnClap', 'settings.wakeOnClap.desc')}
        <ShortcutRow
          label={t('shortcut.pushToTalk')}
          value={s.pushToTalk}
          platform={p.platform}
          conflict={p.shortcutConflicts.includes(s.pushToTalk)}
          onChange={(pushToTalk) => p.onPatch({ pushToTalk })}
        />
        {sw('conversationMode', 'settings.conversationMode')}
        {sw('echoCancellation', 'settings.echoCancellation')}
        {sw('muteDuringFocus', 'settings.muteDuringFocus')}
      </Section>
      <Section title={t('models.title')}>
        <ModelList models={p.models} onDownload={p.onDownloadModels} />
      </Section>
    </>
  );
}

const MCP_COMMANDS = {
  claude: 'claude mcp add jarvis -- node /path/to/jarvis-mcp.mjs',
  codex: 'codex mcp add jarvis -- node /path/to/jarvis-mcp.mjs',
};

const card = 'flex flex-col gap-2.5 rounded-[14px] border border-border bg-surface-raised p-4';

function CopyBox({ text, onCopy }: { text: string; onCopy(text: string): void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-1.5 rounded-[9px] border border-border bg-surface-sunken py-1 pr-1 pl-2.5">
      <code className="min-w-0 flex-1 truncate font-mono text-[12px]" data-selectable>
        {text}
      </code>
      <button
        type="button"
        aria-label={`${t('common.copy')}: ${text}`}
        onClick={() => {
          onCopy(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
        className="inline-flex h-7 cursor-pointer items-center gap-[5px] rounded-[7px] border-0 bg-surface-raised px-2 text-[12px] font-semibold text-text"
      >
        {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        {copied ? t('common.copied') : t('common.copy')}
      </button>
    </div>
  );
}

const EXTENSION_URL = 'https://github.com/lopadova/jarvis-desktop/releases/latest/download/jarvis.mcpb';

function IntegrationsTab(p: SettingsProps) {
  const t = useT();
  const [relayUrl, setRelayUrl] = useState(p.settings.relayUrl);
  const status = p.relay.status;
  const pair = {
    unpaired: { color: 'var(--color-text-subtle)', icon: CircleDashed },
    connecting: { color: 'var(--color-accent)', icon: LoaderCircle },
    connected: { color: 'var(--color-success)', icon: Smartphone },
    offline: { color: 'var(--color-danger)', icon: WifiOff },
  }[status];
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3">
      <div className={card}>
        <span className="flex items-center gap-2 text-[14px] font-semibold">
          <AppWindow size={16} aria-hidden="true" className="text-muted" />
          {t('integrations.claudeDesktop')}
        </span>
        <span className="text-pretty text-[12.5px] leading-[1.45] text-muted">
          {t('integrations.claudeDesktop.hint')}
        </span>
        <div>
          <button type="button" className={primaryBtn} onClick={() => p.onOpenUrl(EXTENSION_URL)}>
            <Download size={14} aria-hidden="true" />
            {t('integrations.install')}
          </button>
          <p className="text-pretty m-0 mt-2 text-[12px] leading-[1.45] text-muted">{t('integrations.install.hint')}</p>
        </div>
      </div>
      <div className={card}>
        <span className="flex items-center gap-2 text-[14px] font-semibold">
          <Terminal size={16} aria-hidden="true" className="text-muted" />
          {t('integrations.cli')}
        </span>
        <span className="text-pretty text-[12.5px] leading-[1.45] text-muted">{t('integrations.cli.hint')}</span>
        {(Object.keys(MCP_COMMANDS) as (keyof typeof MCP_COMMANDS)[]).map((k) => (
          <CopyBox key={k} text={MCP_COMMANDS[k]} onCopy={p.onCopy} />
        ))}
      </div>
      <div className={cn(card, 'col-span-full flex-row flex-wrap gap-5')}>
        <div className="flex min-w-[220px] flex-1 flex-col gap-2.5">
          <span className="flex items-center gap-2 text-[14px] font-semibold">
            <RadioTower size={16} aria-hidden="true" className="text-muted" />
            {t('integrations.chatgpt')}
          </span>
          <span className="text-pretty text-[12.5px] leading-[1.45] text-muted">{t('integrations.chatgpt.hint')}</span>
          <StatusChip color={pair.color} icon={pair.icon} className="self-start">
            {t(`relay.status.${status}` as MessageKey)}
          </StatusChip>
          <input
            value={relayUrl}
            onChange={(e) => setRelayUrl(e.target.value)}
            placeholder="https://relay.example.workers.dev"
            aria-label={t('integrations.relayUrl')}
            className={cn(fieldClass, 'bg-surface-sunken font-mono text-[12.5px]')}
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              className={primaryBtn}
              disabled={!/^https:\/\//.test(relayUrl)}
              onClick={() => p.onPair(relayUrl)}
            >
              {status === 'unpaired' ? t('integrations.pair') : t('integrations.newCode')}
            </button>
            {status !== 'unpaired' ? (
              <button type="button" className={outlineBtn()} onClick={p.onUnpair}>
                {t('integrations.unpair')}
              </button>
            ) : null}
          </div>
          {p.relay.error ? <span className="text-[12px] text-danger">{p.relay.error}</span> : null}
          <div className="[&>.row]:border-t-0 [&>.row]:pb-0">
            <Row label={t('integrations.writeTools')} desc={t('integrations.writeTools.hint')}>
              <Switch
                checked={p.settings.relayExposeWriteTools}
                onCheckedChange={(v) => p.onPatch({ relayExposeWriteTools: v })}
                label={t('integrations.writeTools')}
              />
            </Row>
          </div>
        </div>
        <PairingQR relay={p.relay} />
      </div>
    </div>
  );
}
