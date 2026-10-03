/**
 * Container components: wire the zustand store + IPC to the presentational surfaces.
 * This is the only layer that knows about RPC methods and Tauri commands.
 * Settings and Onboarding live in their own lazily-loaded modules (code split).
 */
import { type Memory, type Project, type SuggestionRequirement, suggestionsFor, type Turn } from '@jarvis/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HomeScreen, type RailView } from '../components/home/HomeScreen';
import type { OrbState } from '../components/orb/Orb';
import { ListeningPill, orbStateFor } from '../components/pill/ListeningPill';
import { SessionsPanel } from '../components/sessions/SessionsPanel';
import { useT } from '../i18n';
import { pushToTalk, showWindow, windowAction } from '../lib/tauri';
import { send, useApp } from '../store/app';
import type { Platform, SuggestionCategory } from '../types/ui';
import { Toasts } from './Toasts';

const LIVE = new Set(['running', 'needs-input', 'approval']);

export function PillSurface({ platform }: { platform: Platform }) {
  const pill = useApp((s) => s.pill);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const k = useApp.getState().pill.state.kind;
      // Esc stops/dismisses the pill, but never decides an approval from here (the card handles Esc = Deny).
      if (k !== 'approval' && k !== 'hidden') send('voice.stopSpeaking', {});
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
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
        onReview={() => void showWindow('pill')}
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

const FORGET_UNDO_MS = 5000;

export function HomeSurface({ platform }: { platform: Platform }) {
  const s = useApp();
  const t = useT();
  const [category, setCategory] = useState<SuggestionCategory | 'for-you'>('for-you');
  const [spokenHint, setSpokenHint] = useState<string | null>(null);
  const [rail, setRail] = useState<RailView>('home');
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [history, setHistory] = useState<Turn[] | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [pendingForget, setPendingForget] = useState<string[]>([]);
  const forgetTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const hour = new Date().getHours();
  const connected = s.connection === 'open';
  const developer = s.providers.some((p) => (p.id === 'claude' || p.id === 'codex') && p.connected);
  const forYou = useMemo(
    () => suggestionsFor({ locale: s.settings.locale, hour, capabilities: capabilities(developer) }, 8),
    [s.settings.locale, hour, developer],
  );
  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const ptt = useCallback((pressed: boolean) => {
    useApp.getState().setPushToTalk(pressed);
    void pushToTalk(pressed);
  }, []);

  // Load the rail views on demand.
  useEffect(() => {
    if (!connected) return;
    const call = useApp.getState().call;
    if (rail === 'memory')
      call('memory.list', {})
        .then((r) => setMemories((r as { memories?: Memory[] }).memories ?? []))
        .catch(() => setMemories([]));
    if (rail === 'history')
      call('history.list', { limit: 100 })
        .then((r) => setHistory((r as { turns?: Turn[] }).turns ?? []))
        .catch(() => setHistory([]));
    if (rail === 'projects')
      call('projects.list', {})
        .then((r) => setProjects((r as { projects?: Project[] }).projects ?? []))
        .catch(() => setProjects([]));
  }, [rail, connected]);

  useEffect(() => {
    const timers = forgetTimers.current;
    return () => {
      // Leaving the window commits pending deletions (the undo window is a UI affordance only).
      for (const [id, timer] of timers) {
        clearTimeout(timer);
        send('memory.remove', { id });
      }
      timers.clear();
    };
  }, []);

  const pillKind = s.pill.state.kind;
  const orbState: OrbState =
    pillKind === 'hidden' || pillKind === 'idle-hint' || pillKind === 'clarify' ? 'idle' : orbStateFor(s.pill.state);
  const level = s.pill.state.kind === 'listening' || s.pill.state.kind === 'speaking' ? s.pill.state.level : s.micLevel;

  return (
    <HomeScreen
      platform={platform}
      userName={s.settings.userName}
      hour={hour}
      connected={connected}
      micLive={s.micOpen || s.pushToTalk || pillKind === 'listening'}
      wakeWord={s.settings.wakeWord}
      privateMode={s.pill.privateMode || s.settings.privateMode}
      localVoice={s.settings.stt === 'local-whisper'}
      orbState={orbState}
      level={level}
      sessionsToday={s.sessions.filter((x) => x.startedAt >= startOfDay || LIVE.has(x.status)).length}
      runningSessions={s.sessions.filter((x) => LIVE.has(x.status)).length}
      providers={s.providers}
      primary={s.settings.primaryBrain ?? s.providers.find((p) => p.primary)?.id ?? null}
      localModel={s.settings.localBrain.model}
      suggestions={s.suggestions}
      forYou={forYou}
      activeCategory={category}
      chat={s.chat}
      pendingApprovals={s.pending.map((r) => r.id)}
      resolvedApprovals={s.resolved}
      recording={s.pushToTalk}
      pushToTalkKeys={s.settings.pushToTalk.split('+')}
      spokenHint={spokenHint}
      rail={rail}
      memories={memories}
      pendingForget={pendingForget}
      history={history}
      projects={projects}
      overlay={<Toasts />}
      onRail={setRail}
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
      onViewSessions={() => void showWindow('sessions')}
      onApproval={(id, decision) => send('approval.decide', { id, decision, via: 'click' })}
      onForget={(id) => {
        setPendingForget((x) => [...x, id]);
        forgetTimers.current.set(
          id,
          setTimeout(() => {
            forgetTimers.current.delete(id);
            send('memory.remove', { id });
            setMemories((m) => m?.filter((x) => x.id !== id) ?? null);
            setPendingForget((x) => x.filter((y) => y !== id));
          }, FORGET_UNDO_MS),
        );
      }}
      onUndoForget={(id) => {
        clearTimeout(forgetTimers.current.get(id));
        forgetTimers.current.delete(id);
        setPendingForget((x) => x.filter((y) => y !== id));
      }}
      onAttachClipboard={async () => {
        try {
          const text = (await navigator.clipboard?.readText?.()) ?? '';
          return text.trim().slice(0, 4000) || null;
        } catch {
          return null;
        }
      }}
      onAttachScreenshot={() => send('turn.submit', { text: t('composer.screenQuestion'), source: 'text' })}
      onSettings={(tab) => void showWindow('settings', tab)}
      onWindow={(a) => void windowAction(a)}
    />
  );
}
