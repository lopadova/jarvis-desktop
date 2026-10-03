/**
 * Container components: wire the zustand store + IPC to the presentational surfaces.
 * This is the only layer that knows about RPC methods and Tauri commands.
 */
import { type Project, type SettingsTab, SETTINGS_TABS, suggestionsFor, type SuggestionRequirement } from '@jarvis/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { HomeScreen } from '../components/home/HomeScreen';
import { Onboarding } from '../components/onboarding/Onboarding';
import { ListeningPill } from '../components/pill/ListeningPill';
import { SessionsPanel } from '../components/sessions/SessionsPanel';
import { Settings } from '../components/settings/Settings';
import { useT } from '../i18n';
import { downloadModels, micMonitor, onShellEvent, pushToTalk, reloadShortcuts, SHELL_EVENTS, showWindow, windowAction } from '../lib/tauri';
import { send, useApp } from '../store/app';
import type { Platform, SuggestionCategory } from '../types/ui';

const LIVE = new Set(['running', 'needs-input', 'approval']);

export function PillSurface({ platform }: { platform: Platform }) {
  const pill = useApp((s) => s.pill);
  const t = useT();
  return (
    <div className="flex h-full items-start justify-center p-2">
      <ListeningPill
        state={pill.state}
        privateMode={pill.privateMode}
        platform={platform}
        onStop={() => send('voice.stopSpeaking', {})}
        onQuickReply={(text) => send('turn.submit', { text, source: 'chip' })}
        onErrorAction={() => void showWindow('settings')}
        onApprovalDecision={(id, decision) => send('approval.decide', { id, decision, via: 'click' })}
      />
      <span className="sr-only">{t('pill.label')}</span>
    </div>
  );
}

export function SessionsSurface() {
  const sessions = useApp((s) => s.sessions);
  const locale = useApp((s) => s.settings.locale);
  return (
    <div className="flex h-full items-start justify-end p-2">
      <SessionsPanel
        sessions={sessions}
        locale={locale}
        onOpen={(id) => send('session.open', { id })}
        onLog={(id) => send('session.showLog', { id })}
        onReply={(id, text) => send('session.reply', { id, text })}
        onStop={(id) => send('session.stop', { id })}
        onDismiss={(id) => send('session.dismiss', { id })}
        onClearFinished={() => send('session.clearFinished', {})}
        onClose={() => void windowAction('close')}
      />
    </div>
  );
}

function capabilities(developer: boolean): Set<SuggestionRequirement> {
  // Calendar/email MCP detection arrives with the integrations work; screen & clipboard are always local.
  const caps = new Set<SuggestionRequirement>(['screen', 'clipboard', 'agent']);
  if (developer) caps.add('developer');
  return caps;
}

export function HomeSurface({ platform }: { platform: Platform }) {
  const s = useApp();
  const [category, setCategory] = useState<SuggestionCategory | 'for-you'>('for-you');
  const [spokenHint, setSpokenHint] = useState<string | null>(null);
  const hour = new Date().getHours();
  const developer = s.providers.some((p) => (p.id === 'claude' || p.id === 'codex') && p.connected);
  const forYou = useMemo(
    () => suggestionsFor({ locale: s.settings.locale, hour, capabilities: capabilities(developer) }, 12),
    [s.settings.locale, hour, developer],
  );
  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const ptt = useCallback((pressed: boolean) => {
    useApp.getState().setPushToTalk(pressed);
    void pushToTalk(pressed);
  }, []);

  return (
    <HomeScreen
      platform={platform}
      userName={s.settings.userName}
      hour={hour}
      connected={s.connection === 'open'}
      micLive={s.pushToTalk || s.pill.state.kind === 'listening'}
      privateMode={s.pill.privateMode || s.settings.privateMode}
      sessionsToday={s.sessions.filter((x) => x.startedAt >= startOfDay || LIVE.has(x.status)).length}
      providers={s.providers}
      primary={s.settings.primaryBrain}
      suggestions={s.suggestions}
      forYou={forYou}
      activeCategory={category}
      chat={s.chat}
      recording={s.pushToTalk}
      pushToTalkKeys={s.settings.pushToTalk.split('+')}
      spokenHint={spokenHint}
      onCategoryChange={setCategory}
      onPick={(sug) => {
        setSpokenHint(sug.utterance);
        // A chip is equivalent to speaking its utterance.
        send('turn.submit', { text: sug.utterance, source: 'chip' });
      }}
      onSubmit={(text) => send('turn.submit', { text, source: 'text' })}
      onPushToTalk={ptt}
      onPrimaryChange={(brain) => send('providers.setPrimary', { brain })}
      onOpenSession={(id) => send('session.open', { id })}
      onReviewApproval={() => void showWindow('pill')}
      onNavigate={(target) => {
        if (target === 'settings') void showWindow('settings');
        else if (target === 'projects') void showWindow('settings', 'agents');
        else if (target !== 'home') void showWindow('settings', 'privacy');
      }}
      onWindow={(a) => void windowAction(a)}
    />
  );
}

function initialTab(): SettingsTab {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '').get('tab');
  return SETTINGS_TABS.find((t) => t === q) ?? 'general';
}

export function SettingsSurface({ platform }: { platform: Platform }) {
  const s = useApp();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [projects, setProjects] = useState<Project[]>([]);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const connected = s.connection === 'open';

  useEffect(() => {
    let off: (() => void) | undefined;
    void onShellEvent<{ tab?: string }>(SHELL_EVENTS.navigate, (e) => {
      const next = SETTINGS_TABS.find((x) => x === e.tab);
      if (next) setTab(next);
    }).then((f) => {
      off = f;
    });
    return () => off?.();
  }, []);

  useEffect(() => {
    if (!connected) return;
    useApp
      .getState()
      .call('projects.list', {})
      .then((r) => setProjects((r as { projects?: Project[] }).projects ?? []))
      .catch(() => {});
  }, [connected]);

  const onPatch = (patch: Record<string, unknown>) => {
    send('settings.update', { patch });
    if ('pushToTalk' in patch || 'toggleSessions' in patch) {
      const next = { ...s.settings, ...patch };
      void reloadShortcuts(next.pushToTalk, next.toggleSessions).then(setConflicts);
    }
  };

  return (
    <Settings
      platform={platform}
      tab={tab}
      settings={s.settings}
      providers={s.providers}
      projects={projects}
      relay={s.relay}
      models={s.models}
      micLevel={s.micLevel}
      version={s.version}
      shortcutConflicts={conflicts}
      onTabChange={setTab}
      onPatch={onPatch}
      onSetPrimary={(brain) => send('providers.setPrimary', { brain })}
      onSignIn={(provider) => send('providers.signIn', { provider })}
      onSignOut={(provider) => send('providers.signOut', { provider })}
      onSecret={(key, value) => send('secrets.set', { key, value })}
      onDeleteSecret={(key) => send('secrets.delete', { key })}
      onProjectPermission={(project, permission) => {
        setProjects((ps) => ps.map((x) => (x.id === project.id ? { ...x, permission } : x)));
        send('projects.upsert', { project: { ...project, permission } });
      }}
      onTtsPreview={(provider) => send('tts.preview', { provider })}
      onDownloadModels={() => void downloadModels()}
      onMicMonitor={(on) => void micMonitor(on)}
      onPair={(relayUrl) => send('relay.pair', { relayUrl })}
      onUnpair={() => send('relay.unpair', {})}
      onClearHistory={(scope) => send('history.clear', { scope })}
      onClearMemory={() => send('memory.clear', {})}
      onCopy={(text) => void navigator.clipboard?.writeText(text)}
      onWindow={(a) => void windowAction(a)}
    />
  );
}

export function OnboardingSurface({ platform }: { platform: Platform }) {
  const s = useApp();
  const monitor = useCallback((on: boolean) => void micMonitor(on), []);
  return (
    <Onboarding
      platform={platform}
      locale={s.settings.locale}
      providers={s.providers}
      micLevel={s.micLevel}
      tts={s.settings.tts}
      pill={s.pill.state}
      privateMode={s.pill.privateMode}
      onMicMonitor={monitor}
      onSignInChatGpt={() => send('providers.signIn', { provider: 'chatgpt' })}
      onSecret={(key, value) => send('secrets.set', { key, value })}
      onUseLocal={() => send('providers.setPrimary', { brain: 'local' })}
      onUseClaude={() => send('providers.setPrimary', { brain: 'claude' })}
      onTts={(tts) => send('settings.update', { patch: { tts } })}
      onPreview={(provider) => send('tts.preview', { provider })}
      onLocale={(locale) => send('settings.update', { patch: { locale } })}
      onFinish={() => {
        send('settings.update', { patch: { onboardingComplete: true } });
        void showWindow('home');
        void windowAction('close');
      }}
    />
  );
}
