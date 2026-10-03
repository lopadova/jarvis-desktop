/** S3 — Home: rail · greeting + orb · suggestion chips · conversation · composer · footer status. */
import { History, House, Lock, Mic, MicOff, Settings as SettingsIcon, Brain, FolderGit2, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { type MessageKey, useT } from '../../i18n';
import { cn } from '../../lib/cn';
import type {
  BrainId,
  ChatMessage,
  Platform,
  ProviderStatus,
  Suggestion,
  SuggestionCategory,
} from '../../types/ui';
import { UsageMeter, WindowControls } from '../common/common';
import { Orb } from '../orb/Orb';
import { Composer } from './Composer';
import { ChatBubble } from './Conversation';
import { SuggestionGrid } from './SuggestionGrid';

export interface HomeScreenProps {
  platform: Platform;
  userName: string;
  hour: number;
  connected: boolean;
  micLive: boolean;
  privateMode: boolean;
  sessionsToday: number;
  providers: ProviderStatus[];
  primary: BrainId | null;
  suggestions: Suggestion[];
  forYou: Suggestion[];
  activeCategory: SuggestionCategory | 'for-you';
  chat: ChatMessage[];
  recording: boolean;
  pushToTalkKeys: string[];
  /** Utterance of the last chip picked, shown as "you could also say…". */
  spokenHint: string | null;
  onCategoryChange(c: SuggestionCategory | 'for-you'): void;
  onPick(s: Suggestion): void;
  onSubmit(text: string): void;
  onPushToTalk(pressed: boolean): void;
  onPrimaryChange(b: BrainId): void;
  onOpenSession(id: string): void;
  onReviewApproval(id: string): void;
  onNavigate(target: 'home' | 'history' | 'memory' | 'projects' | 'settings'): void;
  onWindow(action: 'minimize' | 'maximize' | 'close'): void;
}

export function greetingKey(hour: number): MessageKey {
  if (hour >= 5 && hour < 12) return 'home.greeting.morning';
  if (hour >= 12 && hour < 18) return 'home.greeting.afternoon';
  return 'home.greeting.evening';
}

export function HomeScreen(p: HomeScreenProps) {
  const t = useT();
  const endRef = useRef<HTMLDivElement>(null);
  const primary = p.providers.find((x) => x.primary) ?? p.providers.find((x) => x.id === p.primary);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [p.chat.length]);

  const rail = [
    { id: 'home', icon: House, label: t('rail.home') },
    { id: 'history', icon: History, label: t('rail.history') },
    { id: 'memory', icon: Brain, label: t('rail.memory') },
    { id: 'projects', icon: FolderGit2, label: t('rail.projects') },
    { id: 'settings', icon: SettingsIcon, label: t('rail.settings') },
  ] as const;

  return (
    <div className="flex h-full flex-col">
      <header data-tauri-drag-region className={cn('flex h-9 shrink-0 items-center', p.platform === 'mac' ? 'justify-start' : 'justify-end')}>
        <WindowControls
          platform={p.platform}
          onMinimize={() => p.onWindow('minimize')}
          onMaximize={() => p.onWindow('maximize')}
          onClose={() => p.onWindow('close')}
        />
      </header>
      <div className="flex min-h-0 flex-1">
        <nav aria-label={t('rail.label')} className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-border py-2">
          {rail.map(({ id, icon: I, label }) => (
            <button
              key={id}
              type="button"
              aria-label={label}
              aria-current={id === 'home' ? 'page' : undefined}
              title={label}
              onClick={() => p.onNavigate(id)}
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-md text-muted hover:bg-surface-raised hover:text-text',
                id === 'home' && 'bg-accent-soft text-accent',
              )}
            >
              <I size={18} aria-hidden="true" />
            </button>
          ))}
        </nav>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-6 py-6">
              <section className="flex items-center gap-5">
                <Orb size={96} state="idle" privateMode={p.privateMode} />
                <div className="min-w-0">
                  <h1 className="text-2xl font-semibold">
                    {t(greetingKey(p.hour), { name: p.userName || t('home.friend') })}
                  </h1>
                  <p className="text-sm text-muted">
                    {[
                      primary ? t('home.status.brain', { brain: primary.plan ?? t(`brain.${primary.id}` as MessageKey) }) : t('home.status.noBrain'),
                      t('home.status.sessions', { n: p.sessionsToday }),
                      p.privateMode ? t('home.status.local') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </section>

              <SuggestionGrid
                suggestions={p.suggestions}
                forYou={p.forYou}
                activeCategory={p.activeCategory}
                onCategoryChange={p.onCategoryChange}
                onPick={p.onPick}
              />
              {p.spokenHint ? (
                <p role="status" className="-mt-3 text-xs text-subtle">
                  {t('home.spokenHint', { utterance: p.spokenHint })}
                </p>
              ) : null}

              <section aria-label={t('home.conversation')} aria-live="polite" className="flex flex-col gap-3">
                {p.chat.map((m) => (
                  <ChatBubble key={m.id} message={m} onOpenSession={p.onOpenSession} onReviewApproval={p.onReviewApproval} />
                ))}
                <div ref={endRef} />
              </section>
            </div>
          </div>

          <div className="mx-auto w-full max-w-[760px] px-6 pb-2">
            <Composer
              providers={p.providers}
              primary={p.primary}
              recording={p.recording}
              disabled={!p.connected}
              platform={p.platform}
              pushToTalkKeys={p.pushToTalkKeys}
              onSubmit={p.onSubmit}
              onPushToTalk={p.onPushToTalk}
              onPrimaryChange={p.onPrimaryChange}
            />
          </div>

          <footer className="flex items-center gap-4 border-t border-border px-6 py-2 text-xs text-subtle">
            {primary ? <UsageMeter pct={primary.usagePct} label={primary.plan ?? t(`brain.${primary.id}` as MessageKey)} /> : null}
            <div className="flex-1" />
            {p.privateMode ? (
              <span className="inline-flex items-center gap-1 text-private">
                <Lock size={12} aria-hidden="true" />
                {t('pill.private')}
              </span>
            ) : null}
            {/* R11: visible microphone state. */}
            <span className={cn('inline-flex items-center gap-1', p.micLive ? 'text-danger' : '')} data-testid="mic-indicator">
              {p.micLive ? <Mic size={12} aria-hidden="true" /> : <MicOff size={12} aria-hidden="true" />}
              {p.micLive ? t('footer.micLive') : t('footer.micOff')}
            </span>
            <span className="inline-flex items-center gap-1">
              {p.connected ? <Wifi size={12} aria-hidden="true" /> : <WifiOff size={12} aria-hidden="true" />}
              {p.connected ? t('footer.connected') : t('footer.disconnected')}
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
