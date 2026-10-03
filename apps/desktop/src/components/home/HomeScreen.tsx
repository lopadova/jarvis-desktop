/**
 * S3 — Home (handoff "Prototype" window): title bar · rail · greeting + orb · suggestion chips ·
 * conversation · composer · footer (usage meter, R11 microphone indicator, connection).
 */
import type { Memory, Project, ShoppingItem, Turn } from '@jarvis/core';
import {
  Brain,
  FolderKanban,
  History,
  House,
  Lock,
  type LucideIcon,
  Mic,
  MicOff,
  PanelRight,
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
  Undo2,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { type MessageKey, useLocale, useT } from '../../i18n';
import { cn } from '../../lib/cn';
import type {
  ApprovalDecision,
  BrainId,
  ChatMessage,
  Platform,
  ProviderStatus,
  RailView,
  Suggestion,
  SuggestionCategory,
} from '../../types/ui';
import { LinuxCaption, MacLights, UsageBar, WinCaption, type WindowAction } from '../common/common';
import { WindowFrame } from '../common/WindowFrame';
import { Orb, type OrbState } from '../orb/Orb';
import { Composer } from './Composer';
import { ChatBubble, formatTime } from './Conversation';
import { SuggestionGrid } from './SuggestionGrid';

export type { RailView };

export interface HomeScreenProps {
  platform: Platform;
  userName: string;
  hour: number;
  connected: boolean;
  /** The microphone is capturing right now (R11). */
  micLive: boolean;
  /** Wake word enabled (the mic listens on device for "Jarvis"). */
  wakeWord: boolean;
  privateMode: boolean;
  localVoice: boolean;
  orbState: OrbState;
  level: number;
  sessionsToday: number;
  runningSessions: number;
  providers: ProviderStatus[];
  primary: BrainId | null;
  localModel?: string;
  suggestions: Suggestion[];
  forYou: Suggestion[];
  activeCategory: SuggestionCategory | 'for-you';
  chat: ChatMessage[];
  pendingApprovals: string[];
  resolvedApprovals: Record<string, ApprovalDecision>;
  recording: boolean;
  pushToTalkKeys: string[];
  /** Utterance of the last chip picked, announced as "next time just say…". */
  spokenHint: string | null;
  rail: RailView;
  memories: Memory[] | null;
  pendingForget: string[];
  history: Turn[] | null;
  projects: Project[] | null;
  /** Live shopping list: the newest shopping card in the conversation shows it with remove buttons. */
  shopping?: ShoppingItem[];
  /** Toasts etc. rendered inside the window card. */
  overlay?: ReactNode;
  onRail(view: RailView): void;
  onCategoryChange(c: SuggestionCategory | 'for-you'): void;
  onPick(s: Suggestion): void;
  onSubmit(text: string): void;
  onPushToTalk(pressed: boolean): void;
  onPrimaryChange(b: BrainId): void;
  onOpenSession(id: string): void;
  onViewSessions(): void;
  onApproval(id: string, decision: ApprovalDecision): void;
  onReplay?(id: string): void;
  onForget(id: string): void;
  onUndoForget(id: string): void;
  onCopy?(text: string): void;
  onShoppingRemove?(id: string): void;
  onAttachClipboard?(): Promise<string | null>;
  onAttachScreenshot?(): void;
  onSettings(tab?: string): void;
  onWindow(action: WindowAction): void;
}

export function greetingKey(hour: number): MessageKey {
  if (hour >= 5 && hour < 12) return 'home.greeting.morning';
  if (hour >= 12 && hour < 18) return 'home.greeting.afternoon';
  return 'home.greeting.evening';
}

const RAIL: { id: RailView | 'settings'; icon: LucideIcon }[] = [
  { id: 'home', icon: House },
  { id: 'history', icon: History },
  { id: 'memory', icon: Brain },
  { id: 'projects', icon: FolderKanban },
  { id: 'settings', icon: SettingsIcon },
];

const Dot = ({ color }: { color: string }) => (
  <span className="h-1.5 w-1.5 shrink-0 rounded-pill" style={{ background: color }} />
);

export function HomeScreen(p: HomeScreenProps) {
  const t = useT();
  const locale = useLocale();
  const scrollRef = useRef<HTMLDivElement>(null);
  const primary = p.providers.find((x) => x.id === p.primary) ?? p.providers.find((x) => x.primary);
  const brainLabel = (id: BrainId) => t(`brain.${id}` as MessageKey);

  const lastShoppingCard = p.chat.findLast((m) => m.role === 'system' && m.card.type === 'shopping')?.id;

  const prevLen = useRef(p.chat.length);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to the newest message whenever one arrives.
  useEffect(() => {
    const el = scrollRef.current;
    const before = prevLen.current;
    prevLen.current = p.chat.length;
    // The initial history load keeps the greeting in view; only new messages scroll.
    if (!el || p.rail !== 'home' || before === 0 || p.chat.length <= before) return;
    const id = setTimeout(() => el.scrollTo?.({ top: el.scrollHeight, behavior: 'smooth' }), 30);
    return () => clearTimeout(id);
  }, [p.chat.length]);

  const statusBits: { text: string; color: string }[] = [
    p.privateMode
      ? { text: t('home.status.localOnly'), color: 'var(--color-private)' }
      : primary?.connected
        ? {
            text: t('home.status.brain', { brain: primary.plan ?? brainLabel(primary.id) }),
            color: 'var(--color-success)',
          }
        : { text: t('home.status.noBrain'), color: 'var(--color-warning)' },
    { text: t('home.status.sessions', { n: p.sessionsToday }), color: 'var(--color-accent)' },
    {
      text: p.localVoice ? t('home.status.localVoice') : t('home.status.cloudVoice'),
      color: 'var(--color-text-subtle)',
    },
  ];

  // R11: always show what the microphone is doing.
  const mic = p.micLive
    ? { icon: Mic, color: 'var(--color-danger)', text: t('footer.micLive') }
    : p.privateMode
      ? { icon: Lock, color: 'var(--color-private)', text: t('footer.micLocal') }
      : p.wakeWord
        ? { icon: Mic, color: 'var(--color-success)', text: t('footer.micListening') }
        : { icon: MicOff, color: 'var(--color-text-subtle)', text: t('footer.micMuted') };
  const MicIcon = mic.icon;

  const titleBar = (
    <div data-tauri-drag-region className="flex h-10 shrink-0 items-center gap-2 border-b border-border pl-[14px]">
      {p.platform === 'mac' ? <MacLights onAction={p.onWindow} /> : null}
      <span data-tauri-drag-region className="flex-1 text-center text-[12.5px] font-semibold text-muted">
        Jarvis
      </span>
      <button
        type="button"
        onClick={p.onViewSessions}
        aria-label={t('sessions.title')}
        title={t('sessions.title')}
        className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[7px] border-0 bg-transparent px-2 text-[12px] font-semibold text-muted hover:text-text"
        style={{ marginRight: p.platform === 'win' ? 4 : p.platform === 'linux' ? 0 : 10 }}
      >
        <PanelRight size={15} aria-hidden="true" />
        {p.runningSessions ? t('home.running', { n: p.runningSessions }) : t('sessions.title')}
      </button>
      {p.platform === 'win' ? <WinCaption onAction={p.onWindow} /> : null}
      {p.platform === 'linux' ? <LinuxCaption onAction={p.onWindow} /> : null}
    </div>
  );

  const rail = (
    <nav
      aria-label={t('rail.label')}
      className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-border py-3"
    >
      {RAIL.map(({ id, icon: I }) => {
        const on = id === p.rail;
        const label = t(`rail.${id}` as MessageKey);
        return (
          <button
            key={id}
            type="button"
            aria-label={label}
            title={label}
            aria-current={on ? 'page' : undefined}
            onClick={() => (id === 'settings' ? p.onSettings() : p.onRail(id))}
            className={cn(
              'grid h-10 w-10 cursor-pointer place-items-center rounded-[10px] border-0 hover:bg-surface-raised hover:text-text',
              on ? 'bg-accent-soft text-text' : 'bg-transparent text-muted',
            )}
          >
            <I size={19} aria-hidden="true" />
          </button>
        );
      })}
      <span className="flex-1" />
      <span
        role="img"
        aria-label={p.userName || t('home.friend')}
        className="grid h-8 w-8 place-items-center rounded-pill border border-border-strong bg-surface-raised text-[12.5px] font-semibold text-text"
      >
        {(p.userName || '·').slice(0, 1).toUpperCase()}
      </span>
    </nav>
  );

  return (
    <WindowFrame platform={p.platform} width={960} height={680}>
      {titleBar}
      <div className="flex min-h-0 flex-1">
        {rail}
        <main className="flex min-w-0 flex-1 flex-col">
          <div ref={scrollRef} className="scroll-y min-h-0 flex-1">
            <div className="mx-auto flex max-w-[760px] flex-col gap-7 px-7 pt-7 pb-5">
              {p.rail === 'home' ? (
                <>
                  <div className="flex items-center gap-5">
                    <Orb size={96} state={p.orbState} level={p.level} privateMode={p.privateMode} />
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <h1 className="m-0 text-[28px] leading-[1.1] font-[650] tracking-[-0.03em]">
                        {t(greetingKey(p.hour), { name: p.userName || t('home.friend') })}
                      </h1>
                      <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[13px] text-muted">
                        {statusBits.map((b) => (
                          <span key={b.text} className="inline-flex items-center gap-[5px]">
                            <Dot color={b.color} />
                            {b.text}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <SuggestionGrid
                    suggestions={p.suggestions}
                    forYou={p.forYou}
                    activeCategory={p.activeCategory}
                    onCategoryChange={p.onCategoryChange}
                    onPick={p.onPick}
                    disabled={!p.connected}
                  />
                  {p.spokenHint ? (
                    <p role="status" className="sr-only">
                      {t('home.spokenHint', { utterance: p.spokenHint })}
                    </p>
                  ) : null}
                  <section aria-label={t('home.conversation')} aria-live="polite" className="flex flex-col gap-4">
                    {p.chat.map((m) => (
                      <ChatBubble
                        key={m.id}
                        message={m}
                        onReplay={p.onReplay}
                        onOpenSession={p.onOpenSession}
                        onViewSession={p.onViewSessions}
                        onApproval={p.onApproval}
                        onCopy={p.onCopy}
                        shoppingLive={m.id === lastShoppingCard ? p.shopping : undefined}
                        onShoppingRemove={p.onShoppingRemove}
                        resolved={
                          m.role === 'system' && m.card.type === 'approval-needed'
                            ? p.resolvedApprovals[m.card.request.id]
                            : undefined
                        }
                        pending={
                          m.role === 'system' && m.card.type === 'approval-needed'
                            ? p.pendingApprovals.includes(m.card.request.id)
                            : undefined
                        }
                      />
                    ))}
                  </section>
                </>
              ) : null}
              {p.rail === 'memory' ? <MemoryView {...p} /> : null}
              {p.rail === 'history' ? <HistoryView turns={p.history} locale={locale} /> : null}
              {p.rail === 'projects' ? <ProjectsView projects={p.projects} onSettings={p.onSettings} /> : null}
            </div>
          </div>
          <div className="relative px-7 pb-2">
            <div className="relative mx-auto max-w-[760px]">
              <Composer
                providers={p.providers}
                primary={p.primary}
                privateMode={p.privateMode}
                recording={p.recording}
                level={p.level}
                disabled={!p.connected}
                platform={p.platform}
                pushToTalkKeys={p.pushToTalkKeys}
                localModel={p.localModel}
                onSubmit={p.onSubmit}
                onPushToTalk={p.onPushToTalk}
                onPrimaryChange={p.onPrimaryChange}
                onAttachClipboard={p.onAttachClipboard}
                onAttachScreenshot={p.onAttachScreenshot}
              />
            </div>
          </div>
          <footer className="flex h-8 shrink-0 items-center gap-4 border-t border-border px-5 text-[11.5px] text-muted">
            {primary && primary.usagePct !== undefined && !p.privateMode ? (
              <span className="flex items-center gap-2">
                <span>{t('footer.usage', { plan: primary.plan ?? brainLabel(primary.id) })}</span>
                <UsageBar
                  pct={primary.usagePct}
                  label={t('footer.usage', { plan: primary.plan ?? brainLabel(primary.id) })}
                  height={4}
                  width={64}
                />
                <span className="tabular">{Math.round(primary.usagePct)} %</span>
              </span>
            ) : null}
            <span className="flex-1" />
            <span className="flex items-center gap-1.5" data-testid="mic-indicator">
              <MicIcon size={12} aria-hidden="true" style={{ color: mic.color }} />
              {mic.text}
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-pill"
                style={{ background: p.connected ? 'var(--color-success)' : 'var(--color-danger)' }}
              />
              {p.connected ? t('footer.connected') : t('footer.disconnected')}
            </span>
          </footer>
        </main>
      </div>
      {p.overlay}
    </WindowFrame>
  );
}

function MemoryView(p: HomeScreenProps) {
  const t = useT();
  const locale = useLocale();
  const date = (at: number) =>
    new Date(at).toLocaleDateString(locale === 'it' ? 'it-IT' : 'en-GB', { day: 'numeric', month: 'short' });
  return (
    <div className="flex flex-col gap-1">
      <h1 className="m-0 mb-1.5 text-[22px] font-[650] tracking-[-0.02em]">{t('memory.title')}</h1>
      <p className="m-0 mb-3.5 text-[13.5px] text-muted">{t('memory.sub')}</p>
      {p.memories && p.memories.length === 0 ? <p className="text-[13px] text-subtle">{t('memory.empty')}</p> : null}
      {(p.memories ?? []).map((m) => {
        const gone = p.pendingForget.includes(m.id);
        const I = m.source === 'said' ? Mic : Sparkles;
        const act = gone ? t('memory.undo') : t('memory.delete');
        return (
          <div
            key={m.id}
            className="flex items-center gap-3 rounded-[12px] border border-border bg-surface-raised px-[14px] py-3"
            style={{ opacity: gone ? 0.55 : 1 }}
          >
            <I size={16} aria-hidden="true" className="shrink-0 text-muted" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={cn('text-[14px] text-text', gone && 'line-through')}>{m.text}</span>
              <span className="text-[12px] text-subtle">
                {m.source === 'said' ? t('memory.said') : t('memory.inferred')} · {date(m.createdAt)}
              </span>
            </div>
            <button
              type="button"
              aria-label={`${act}: ${m.text}`}
              onClick={() => (gone ? p.onUndoForget(m.id) : p.onForget(m.id))}
              className="inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-[8px] border-0 bg-transparent px-2.5 text-[12px] font-semibold text-muted hover:bg-surface-sunken hover:text-text"
            >
              {gone ? <Undo2 size={14} aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
              {act}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function HistoryView({ turns, locale }: { turns: Turn[] | null; locale: string }) {
  const t = useT();
  if (!turns || turns.length === 0)
    return (
      <div className="flex flex-col items-center px-6 py-24">
        <EmptyBlock title={t('history.empty.title')} body={t('history.empty.body')} />
      </div>
    );
  return (
    <div className="flex flex-col gap-1">
      <h1 className="m-0 mb-3.5 text-[22px] font-[650] tracking-[-0.02em]">{t('rail.history')}</h1>
      {turns.map((x) => (
        <div
          key={`${x.at}-${x.heard}`}
          className="flex flex-col gap-0.5 rounded-[12px] border border-border bg-surface-raised px-[14px] py-3"
        >
          <span className="text-[14px] text-text">{x.heard}</span>
          <span className="text-[12px] text-subtle">
            {formatTime(x.at, locale)} · {x.said}
          </span>
        </div>
      ))}
    </div>
  );
}

function ProjectsView({ projects, onSettings }: { projects: Project[] | null; onSettings(tab?: string): void }) {
  const t = useT();
  if (!projects || projects.length === 0)
    return (
      <div className="flex flex-col items-center px-6 py-24">
        <EmptyBlock title={t('projects.empty.title')} body={t('projects.empty.body')} />
      </div>
    );
  return (
    <div className="flex flex-col gap-1">
      <h1 className="m-0 mb-3.5 text-[22px] font-[650] tracking-[-0.02em]">{t('rail.projects')}</h1>
      {projects.map((pr) => (
        <div
          key={pr.id}
          className="flex items-center gap-3 rounded-[12px] border border-border bg-surface-raised px-[14px] py-3"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[14px] font-semibold text-text">{pr.name}</span>
            <span className="truncate font-mono text-[11.5px] text-subtle">{pr.path}</span>
          </div>
          <span className="text-[12px] text-muted">{t(`permission.${pr.permission}` as MessageKey)}</span>
          <button
            type="button"
            onClick={() => onSettings('agents')}
            className="inline-flex h-[30px] cursor-pointer items-center rounded-[8px] border border-border-strong bg-surface-raised px-2.5 text-[12px] font-semibold text-text"
          >
            {t('projects.manage')}
          </button>
        </div>
      ))}
    </div>
  );
}

function EmptyBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-[14px] text-center">
      <Orb size={64} state="muted" animated={false} />
      <span className="text-[16px] font-semibold">{title}</span>
      <span className="text-pretty max-w-[360px] text-[13.5px] leading-[1.5] text-muted">{body}</span>
    </div>
  );
}
