/** Settings container (lazy chunk): store + IPC → presentational `Settings`. */
import { type Project, SETTINGS_TABS, type SettingsTab } from '@jarvis/core';
import { useEffect, useState } from 'react';
import { Settings, type VoiceInfo } from '../components/settings/Settings';
import {
  downloadModels,
  micMonitor,
  onShellEvent,
  openExternal,
  reloadShortcuts,
  SHELL_EVENTS,
  windowAction,
} from '../lib/tauri';
import { send, useApp } from '../store/app';
import type { Platform } from '../types/ui';
import { Toasts } from './Toasts';

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
    const onHash = () => setTab(initialTab());
    window.addEventListener('hashchange', onHash);
    return () => {
      off?.();
      window.removeEventListener('hashchange', onHash);
    };
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
      overlay={<Toasts bottom={20} />}
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
      onTtsPreview={(provider, voiceId) => send('tts.preview', voiceId ? { provider, voiceId } : { provider })}
      onLoadVoices={(provider) =>
        useApp
          .getState()
          .call('tts.voices', { provider })
          .then((r) => r as { voices: VoiceInfo[]; configured: boolean })
      }
      onOpenUrl={(url) => void openExternal(url)}
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

export default SettingsSurface;
