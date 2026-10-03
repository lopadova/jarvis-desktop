/** S5 — Settings (sidebar tabs). Data in via props, changes out via `onPatch` / callbacks. */
import { type Project, SETTINGS_TABS, type Settings as SettingsData, type SettingsTab } from '@jarvis/core';
import { Copy, Download, Play, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { type MessageKey, useT } from '../../i18n';
import { cn } from '../../lib/cn';
import type { BrainId, ModelStatus, PermissionLevel, Platform, ProviderStatus, RelayState } from '../../types/ui';
import { AgentMark, brainKey, brainMark, ProviderBadge, UsageMeter, WindowControls } from '../common/common';
import { Button } from '../ui/button';
import { Field, Input, NativeSelect, Progress, Switch } from '../ui/primitives';
import { PairingQR, PermissionLevelControl, ShortcutRecorder } from './controls';

export type SecretKey = 'openai-api-key' | 'anthropic-api-key' | 'elevenlabs-api-key' | 'fish-audio-api-key';
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
  onTabChange(tab: SettingsTab): void;
  onPatch(patch: Partial<SettingsData>): void;
  onSetPrimary(b: BrainId): void;
  onSignIn(p: 'chatgpt'): void;
  onSignOut(p: 'chatgpt'): void;
  onSecret(key: SecretKey, value: string): void;
  onDeleteSecret(key: SecretKey): void;
  onProjectPermission(project: Project, level: PermissionLevel): void;
  onTtsPreview(provider: TtsId): void;
  onDownloadModels(): void;
  onMicMonitor(enabled: boolean): void;
  onPair(relayUrl: string): void;
  onUnpair(): void;
  onClearHistory(scope: 'today' | 'all'): void;
  onClearMemory(): void;
  onCopy(text: string): void;
  onWindow(action: 'minimize' | 'close'): void;
}

export function Settings(p: SettingsProps) {
  const t = useT();
  return (
    <div className="flex h-full flex-col">
      <header
        data-tauri-drag-region
        className={cn('flex h-9 shrink-0 items-center', p.platform === 'mac' ? 'justify-start' : 'justify-between')}
      >
        {p.platform === 'mac' ? null : (
          <span data-tauri-drag-region className="px-4 text-sm font-medium">
            {t('settings.title')}
          </span>
        )}
        <WindowControls
          platform={p.platform}
          onMinimize={() => p.onWindow('minimize')}
          onClose={() => p.onWindow('close')}
        />
      </header>
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label={t('settings.title')}
          className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-border p-2"
        >
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              aria-current={p.tab === tab ? 'page' : undefined}
              onClick={() => p.onTabChange(tab)}
              className={cn(
                'h-8 rounded-md px-3 text-left text-sm',
                p.tab === tab ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-raised hover:text-text',
              )}
            >
              {t(`settings.tab.${tab}` as MessageKey)}
            </button>
          ))}
        </nav>
        <main className="scroll-y min-w-0 flex-1 px-6 py-4">
          <h1 className="mb-3 text-xl font-semibold">{t(`settings.tab.${p.tab}` as MessageKey)}</h1>
          <TabBody {...p} />
        </main>
      </div>
    </div>
  );
}

function Section({ title, children, danger }: { title?: string; children: ReactNode; danger?: boolean }) {
  return (
    <section
      className={cn('mb-5 rounded-lg border bg-surface px-4 py-1', danger ? 'border-danger/60' : 'border-border')}
    >
      {title ? <h2 className={cn('pt-3 text-sm font-semibold', danger && 'text-danger')}>{title}</h2> : null}
      {children}
    </section>
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
    <NativeSelect aria-label={label} value={value} onChange={(e) => onChange(e.target.value as V)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </NativeSelect>
  );
}

function SecretField({
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
    <Field label={label} hint={t('secret.hint')}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim()) return;
          onSave(secretKey, value.trim());
          setValue(''); // never kept in UI state or storage after sending (R6)
        }}
      >
        <Input
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={label}
          className="w-56"
        />
        <Button type="submit" size="sm" variant="primary" disabled={!value.trim()}>
          {t('common.save')}
        </Button>
        <Button size="sm" variant="ghost" aria-label={t('secret.delete')} onClick={() => onDelete(secretKey)}>
          <Trash2 size={12} aria-hidden="true" />
        </Button>
      </form>
    </Field>
  );
}

export function ModelList({ models, onDownload }: { models: ModelStatus[]; onDownload(): void }) {
  const t = useT();
  const missing = models.some((m) => m.state === 'missing' || m.state === 'error');
  return (
    <div className="py-3">
      {models.length === 0 ? <p className="text-xs text-subtle">{t('models.unavailable')}</p> : null}
      <ul className="flex flex-col gap-2">
        {models.map((m) => (
          <li key={m.id} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-sm">
              <span>{m.label}</span>
              <span
                className={cn(
                  'text-xs',
                  m.state === 'ready' ? 'text-success' : m.state === 'error' ? 'text-danger' : 'text-subtle',
                )}
              >
                {t(`models.state.${m.state}` as MessageKey)}
              </span>
            </div>
            {m.state === 'downloading' && m.total > 0 ? (
              <Progress value={(m.received / m.total) * 100} label={m.label} />
            ) : null}
            {m.error ? <span className="text-xs text-danger">{m.error}</span> : null}
          </li>
        ))}
      </ul>
      {missing ? (
        <Button className="mt-3" size="sm" variant="primary" onClick={onDownload}>
          <Download size={12} aria-hidden="true" />
          {t('models.download')}
        </Button>
      ) : null}
    </div>
  );
}

export function LevelMeter({ level, label }: { level: number; label: string }) {
  return <Progress value={Math.min(100, level * 100)} label={label} />;
}

function TabBody(p: SettingsProps) {
  const t = useT();
  const s = p.settings;
  const sw = (key: keyof SettingsData, label: MessageKey, hint?: MessageKey) => (
    <Field label={t(label)} hint={hint ? t(hint) : undefined}>
      <Switch
        checked={Boolean(s[key])}
        onCheckedChange={(v) => p.onPatch({ [key]: v } as Partial<SettingsData>)}
        aria-label={t(label)}
      />
    </Field>
  );

  switch (p.tab) {
    case 'general':
      return (
        <Section>
          <Field label={t('settings.name')}>
            <Input
              defaultValue={s.userName}
              maxLength={80}
              className="w-56"
              aria-label={t('settings.name')}
              onBlur={(e) => p.onPatch({ userName: e.target.value })}
            />
          </Field>
          <Field label={t('settings.language')}>
            <Select
              label={t('settings.language')}
              value={s.locale}
              onChange={(locale) => p.onPatch({ locale })}
              options={[
                { value: 'en', label: 'English' },
                { value: 'it', label: 'Italiano' },
              ]}
            />
          </Field>
          <Field label={t('settings.theme')}>
            <Select
              label={t('settings.theme')}
              value={s.theme}
              onChange={(theme) => p.onPatch({ theme })}
              options={(['system', 'dark', 'light'] as const).map((v) => ({
                value: v,
                label: t(`settings.theme.${v}` as MessageKey),
              }))}
            />
          </Field>
          <Field label={t('settings.material')} hint={t('settings.material.hint')}>
            <Select
              label={t('settings.material')}
              value={s.material}
              onChange={(material) => p.onPatch({ material })}
              options={(['auto', 'glass', 'solid'] as const).map((v) => ({
                value: v,
                label: t(`settings.material.${v}` as MessageKey),
              }))}
            />
          </Field>
          <Field label={t('settings.accent')}>
            <input
              type="range"
              min={0}
              max={360}
              defaultValue={s.accentHue}
              aria-label={t('settings.accent')}
              onChange={(e) => p.onPatch({ accentHue: Number(e.target.value) })}
            />
          </Field>
          {sw('launchAtLogin', 'settings.launchAtLogin')}
        </Section>
      );
    case 'brain':
      return (
        <>
          <Section title={t('settings.accounts')}>
            {p.providers.map((pr) => (
              <div key={pr.id} className="flex items-center gap-3 border-b border-border py-3 last:border-b-0">
                <AgentMark id={brainMark(pr.id)} size={14} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {t(brainKey(pr.id))}
                    {pr.primary ? <span className="text-xs text-accent">{t('settings.primary')}</span> : null}
                  </div>
                  <div className="text-xs text-subtle">{[pr.account, pr.plan].filter(Boolean).join(' · ') || '—'}</div>
                </div>
                {pr.usagePct !== undefined ? (
                  <UsageMeter pct={pr.usagePct} label={pr.plan ?? t(brainKey(pr.id))} />
                ) : null}
                <ProviderBadge provider={pr} />
                {pr.connected && !pr.primary ? (
                  <Button size="sm" onClick={() => p.onSetPrimary(pr.id)}>
                    {t('settings.makePrimary')}
                  </Button>
                ) : null}
                {pr.id === 'chatgpt' ? (
                  pr.connected ? (
                    <Button size="sm" variant="ghost" onClick={() => p.onSignOut('chatgpt')}>
                      {t('settings.disconnect')}
                    </Button>
                  ) : (
                    <Button size="sm" variant="primary" onClick={() => p.onSignIn('chatgpt')}>
                      {t('onboarding.brain.chatgpt')}
                    </Button>
                  )
                ) : null}
              </div>
            ))}
          </Section>
          <Section title={t('settings.apiKeys')}>
            <SecretField
              secretKey="anthropic-api-key"
              label={t('secret.anthropic')}
              onSave={p.onSecret}
              onDelete={p.onDeleteSecret}
            />
            <SecretField
              secretKey="openai-api-key"
              label={t('secret.openai')}
              onSave={p.onSecret}
              onDelete={p.onDeleteSecret}
            />
          </Section>
          <Section title={t('settings.local')}>
            <Field label={t('settings.local.url')}>
              <Input
                defaultValue={s.localBrain.baseUrl}
                className="w-64"
                aria-label={t('settings.local.url')}
                onBlur={(e) => p.onPatch({ localBrain: { ...s.localBrain, baseUrl: e.target.value } })}
              />
            </Field>
            <Field label={t('settings.local.model')}>
              <Input
                defaultValue={s.localBrain.model}
                className="w-64"
                aria-label={t('settings.local.model')}
                onBlur={(e) => p.onPatch({ localBrain: { ...s.localBrain, model: e.target.value } })}
              />
            </Field>
          </Section>
        </>
      );
    case 'agents':
      return (
        <>
          <Section>
            <Field label={t('settings.defaultAgent')}>
              <Select
                label={t('settings.defaultAgent')}
                value={s.defaultAgent}
                onChange={(defaultAgent) => p.onPatch({ defaultAgent })}
                options={(['claude', 'codex', 'home'] as const).map((v) => ({
                  value: v,
                  label: t(`agent.${v}` as MessageKey),
                }))}
              />
            </Field>
            <Field label={t('settings.maxSessions')}>
              <Input
                type="number"
                min={1}
                max={12}
                defaultValue={s.maxConcurrentSessions}
                className="w-20"
                aria-label={t('settings.maxSessions')}
                onBlur={(e) => p.onPatch({ maxConcurrentSessions: Number(e.target.value) })}
              />
            </Field>
          </Section>
          <Section title={t('settings.projects')}>
            {p.projects.length === 0 ? (
              <p className="py-3 text-xs text-subtle">{t('settings.projects.empty')}</p>
            ) : null}
            {p.projects.map((pr) => (
              <div key={pr.id} className="flex items-center gap-3 border-b border-border py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{pr.name}</div>
                  <div className="truncate font-mono text-xs text-subtle">{pr.path}</div>
                </div>
                <PermissionLevelControl
                  value={pr.permission}
                  label={t('permission.label', { project: pr.name })}
                  onChange={(lvl) => p.onProjectPermission(pr, lvl)}
                />
              </div>
            ))}
          </Section>
        </>
      );
    case 'voice':
      return (
        <>
          <Section>
            <Field label={t('settings.tts')}>
              <div className="flex gap-2">
                <Select
                  label={t('settings.tts')}
                  value={s.tts}
                  onChange={(tts) => p.onPatch({ tts })}
                  options={(['system', 'elevenlabs', 'fish', 'openai', 'kokoro', 'piper'] as const).map((v) => ({
                    value: v,
                    label: t(`tts.${v}` as MessageKey),
                  }))}
                />
                <Button size="sm" onClick={() => p.onTtsPreview(s.tts)} aria-label={t('voice.preview')}>
                  <Play size={12} aria-hidden="true" />
                </Button>
              </div>
            </Field>
            <Field label={t('settings.rate')}>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.1}
                defaultValue={s.speakingRate}
                aria-label={t('settings.rate')}
                onChange={(e) => p.onPatch({ speakingRate: Number(e.target.value) })}
              />
            </Field>
            {sw('speakReplies', 'settings.speakReplies')}
            {sw('speakProgress', 'settings.speakProgress')}
            {sw('speakSummaries', 'settings.speakSummaries')}
            {sw('muteDuringFocus', 'settings.muteDuringFocus')}
          </Section>
          <Section title={t('settings.apiKeys')}>
            <SecretField
              secretKey="elevenlabs-api-key"
              label={t('secret.elevenlabs')}
              onSave={p.onSecret}
              onDelete={p.onDeleteSecret}
            />
            <SecretField
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
    case 'privacy':
      return (
        <>
          <Section>
            {sw('privateMode', 'settings.privateMode', 'settings.privateMode.hint')}
            <Field label={t('settings.retention')}>
              <Input
                type="number"
                min={0}
                max={3650}
                defaultValue={s.historyRetentionDays}
                className="w-24"
                aria-label={t('settings.retention')}
                onBlur={(e) => p.onPatch({ historyRetentionDays: Number(e.target.value) })}
              />
            </Field>
            {sw('openResults', 'settings.openResults')}
          </Section>
          <Section title={t('settings.danger')} danger>
            <Field label={t('settings.deleteToday')}>
              <Button size="sm" variant="secondary" onClick={() => p.onClearHistory('today')}>
                {t('common.delete')}
              </Button>
            </Field>
            <Field label={t('settings.deleteAll')}>
              <Button size="sm" variant="danger" onClick={() => p.onClearHistory('all')}>
                {t('common.delete')}
              </Button>
            </Field>
            <Field label={t('settings.clearMemory')}>
              <Button size="sm" variant="danger" onClick={p.onClearMemory}>
                {t('common.delete')}
              </Button>
            </Field>
          </Section>
        </>
      );
    case 'integrations':
      return <IntegrationsTab {...p} />;
    case 'shortcuts':
      return (
        <Section>
          <Field label={t('shortcut.pushToTalk')} hint={t('shortcut.pushToTalk.hint')}>
            <ShortcutRecorder
              label={t('shortcut.pushToTalk')}
              value={s.pushToTalk}
              platform={p.platform}
              conflict={p.shortcutConflicts.includes(s.pushToTalk)}
              onChange={(pushToTalk) => p.onPatch({ pushToTalk })}
            />
          </Field>
          <Field label={t('shortcut.toggleSessions')}>
            <ShortcutRecorder
              label={t('shortcut.toggleSessions')}
              value={s.toggleSessions}
              platform={p.platform}
              conflict={p.shortcutConflicts.includes(s.toggleSessions)}
              onChange={(toggleSessions) => p.onPatch({ toggleSessions })}
            />
          </Field>
        </Section>
      );
    case 'about':
      return (
        <Section>
          <Field label={t('about.version')}>
            <span className="font-mono text-sm">{p.version || '—'}</span>
          </Field>
          <Field label={t('about.license')}>
            <span className="text-sm">MIT</span>
          </Field>
          <Field label={t('about.source')}>
            <span className="font-mono text-xs" data-selectable>
              github.com/lopadova/jarvis-desktop
            </span>
          </Field>
        </Section>
      );
    default:
      return null;
  }
}

function MicrophoneTab(p: SettingsProps) {
  const t = useT();
  const s = p.settings;
  const [monitoring, setMonitoring] = useState(false);
  const toggle = () => {
    p.onMicMonitor(!monitoring);
    setMonitoring((m) => !m);
  };
  const sw = (key: keyof SettingsData, label: MessageKey) => (
    <Field label={t(label)}>
      <Switch
        checked={Boolean(s[key])}
        onCheckedChange={(v) => p.onPatch({ [key]: v } as Partial<SettingsData>)}
        aria-label={t(label)}
      />
    </Field>
  );
  return (
    <>
      <Section>
        {sw('wakeWord', 'settings.wakeWord')}
        {sw('wakeOnClap', 'settings.wakeOnClap')}
        {sw('conversationMode', 'settings.conversationMode')}
        {sw('echoCancellation', 'settings.echoCancellation')}
        <Field
          label={t('settings.stt')}
          hint={s.stt === 'local-whisper' ? t('settings.stt.local') : t('settings.stt.cloud')}
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
        </Field>
        <Field label={t('settings.whisperModel')}>
          <Select
            label={t('settings.whisperModel')}
            value={s.whisperModel}
            onChange={(whisperModel) => p.onPatch({ whisperModel })}
            options={(['tiny', 'base', 'small', 'medium', 'large-v3-turbo'] as const).map((v) => ({
              value: v,
              label: v,
            }))}
          />
        </Field>
        <Field label={t('settings.micTest')}>
          <div className="flex w-56 items-center gap-2">
            <LevelMeter level={monitoring ? p.micLevel : 0} label={t('settings.micTest')} />
            <Button size="sm" onClick={toggle} aria-pressed={monitoring}>
              {monitoring ? t('common.stop') : t('common.test')}
            </Button>
          </div>
        </Field>
      </Section>
      <Section title={t('models.title')}>
        <ModelList models={p.models} onDownload={p.onDownloadModels} />
      </Section>
    </>
  );
}

const MCP_COMMANDS = {
  claude: 'claude mcp add jarvis -- jarvis-mcp',
  codex: 'codex mcp add jarvis -- jarvis-mcp',
};

function IntegrationsTab(p: SettingsProps) {
  const t = useT();
  const [relayUrl, setRelayUrl] = useState(p.settings.relayUrl);
  return (
    <>
      <Section title={t('integrations.claudeDesktop')}>
        <Field label={t('integrations.claudeDesktop.install')} hint={t('integrations.claudeDesktop.hint')}>
          <Button size="sm" variant="primary" disabled title={t('common.comingSoon')}>
            {t('integrations.install')}
          </Button>
        </Field>
      </Section>
      <Section title={t('integrations.cli')}>
        {(Object.keys(MCP_COMMANDS) as (keyof typeof MCP_COMMANDS)[]).map((k) => (
          <Field key={k} label={t(`agent.${k}` as MessageKey)}>
            <div className="flex items-center gap-2">
              <code className="rounded-sm bg-surface-sunken px-2 py-1 font-mono text-xs" data-selectable>
                {MCP_COMMANDS[k]}
              </code>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t('common.copy')}
                onClick={() => p.onCopy(MCP_COMMANDS[k])}
              >
                <Copy size={12} aria-hidden="true" />
              </Button>
            </div>
          </Field>
        ))}
      </Section>
      <Section title={t('integrations.chatgpt')}>
        <p className="pt-2 text-xs text-subtle">{t('integrations.chatgpt.hint')}</p>
        <Field label={t('integrations.relayUrl')}>
          <Input
            value={relayUrl}
            onChange={(e) => setRelayUrl(e.target.value)}
            placeholder="https://relay.example.workers.dev"
            className="w-72"
            aria-label={t('integrations.relayUrl')}
          />
        </Field>
        <div className="flex gap-2 py-3">
          <Button
            size="sm"
            variant="primary"
            disabled={!/^https:\/\//.test(relayUrl)}
            onClick={() => p.onPair(relayUrl)}
          >
            {t('integrations.pair')}
          </Button>
          {p.relay.status !== 'unpaired' ? (
            <Button size="sm" variant="ghost" onClick={p.onUnpair}>
              {t('integrations.unpair')}
            </Button>
          ) : null}
        </div>
        <div className="pb-3">
          <PairingQR relay={p.relay} />
        </div>
        <Field label={t('integrations.writeTools')} hint={t('integrations.writeTools.hint')}>
          <Switch
            checked={p.settings.relayExposeWriteTools}
            onCheckedChange={(v) => p.onPatch({ relayExposeWriteTools: v })}
            aria-label={t('integrations.writeTools')}
          />
        </Field>
      </Section>
    </>
  );
}
