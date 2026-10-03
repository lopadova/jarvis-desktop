/** Small shared components from brief §6: AgentMark, ProviderBadge, UsageMeter, KeyHint, WindowControls, EmptyState. */
import { Bot, Code2, Cpu, House, KeyRound, MessageCircle, Minus, Square, Terminal, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { type MessageKey, useT } from '../../i18n';
import { cn } from '../../lib/cn';
import type { AgentId, BrainId, Platform, ProviderStatus } from '../../types/ui';
import { Orb } from '../orb/Orb';
import { Badge, Progress } from '../ui/primitives';

// ── AgentMark ── original simple glyphs; official logos are a later slot.
type MarkId = AgentId | 'chatgpt' | 'local' | 'api';
const MARKS: Record<MarkId, typeof Bot> = {
  claude: Terminal,
  codex: Code2,
  home: House,
  chatgpt: MessageCircle,
  local: Cpu,
  api: KeyRound,
};

export function AgentMark({ id, size = 16, className }: { id: MarkId; size?: number; className?: string }) {
  const C = MARKS[id];
  return (
    <span
      className={cn('inline-flex items-center justify-center rounded-sm bg-surface-raised text-muted', className)}
      style={{ width: size + 8, height: size + 8 }}
      aria-hidden="true"
    >
      <C size={size} />
    </span>
  );
}

export const brainMark = (id: BrainId): MarkId =>
  id === 'api-anthropic' || id === 'api-openai' ? 'api' : id === 'claude' ? 'claude' : id;

export const brainKey = (id: BrainId): MessageKey => `brain.${id}` as MessageKey;

// ── ProviderBadge ──
export function ProviderBadge({ provider }: { provider: Pick<ProviderStatus, 'id' | 'state' | 'connected'> }) {
  const t = useT();
  const tone =
    provider.state === 'ok' && provider.connected
      ? 'success'
      : provider.state === 'error' || provider.state === 'cap-reached'
        ? 'danger'
        : 'warning';
  return (
    <Badge tone={tone}>
      <AgentMark id={brainMark(provider.id)} size={10} className="bg-transparent" />
      {t(brainKey(provider.id))} · {t(`provider.state.${provider.state}` as MessageKey)}
    </Badge>
  );
}

// ── UsageMeter ──
export function UsageMeter({ pct, label }: { pct?: number; label: string }) {
  const t = useT();
  if (pct === undefined) return <span className="text-xs text-subtle">{t('usage.unknown', { label })}</span>;
  const tone = pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : 'accent';
  return (
    <div className="flex min-w-40 flex-col gap-1">
      <span className={cn('text-xs', pct >= 100 ? 'text-danger' : pct >= 80 ? 'text-warning' : 'text-muted')}>
        {pct >= 100 ? t('usage.capReached') : t('usage.pct', { label, pct: Math.round(pct) })}
      </span>
      <Progress value={pct} label={label} tone={tone} />
    </div>
  );
}

// ── KeyHint ──
const MAC_KEYS: Record<string, string> = {
  CommandOrControl: '⌘',
  Command: '⌘',
  Cmd: '⌘',
  Super: '⌘',
  Alt: '⌥',
  Option: '⌥',
  Shift: '⇧',
  Control: '⌃',
  Ctrl: '⌃',
  Space: 'Space',
};
const PC_KEYS: Record<string, string> = { CommandOrControl: 'Ctrl', Control: 'Ctrl', Command: 'Win', Super: 'Win' };

export function keyLabel(key: string, platform: Platform): string {
  return (platform === 'mac' ? MAC_KEYS[key] : PC_KEYS[key]) ?? key;
}

export function KeyHint({ keys, platform, className }: { keys: string[]; platform: Platform; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {keys.map((k) => (
        <kbd
          key={k}
          className="rounded-xs border border-border bg-surface-sunken px-1.5 py-px font-mono text-xs text-muted shadow-sm"
        >
          {keyLabel(k, platform)}
        </kbd>
      ))}
    </span>
  );
}

// ── WindowControls ── mac on the left (traffic lights), win/linux on the right.
export function WindowControls({
  platform,
  onMinimize,
  onMaximize,
  onClose,
}: {
  platform: Platform;
  onMinimize(): void;
  onMaximize?(): void;
  onClose(): void;
}) {
  const t = useT();
  if (platform === 'mac') {
    const dot = 'h-3 w-3 rounded-full border border-black/10';
    return (
      <div className="flex items-center gap-2 px-3">
        <button type="button" aria-label={t('window.close')} onClick={onClose} className={cn(dot, 'bg-[#ff5f57]')} />
        <button
          type="button"
          aria-label={t('window.minimize')}
          onClick={onMinimize}
          className={cn(dot, 'bg-[#febc2e]')}
        />
        {onMaximize ? (
          <button
            type="button"
            aria-label={t('window.maximize')}
            onClick={onMaximize}
            className={cn(dot, 'bg-[#28c840]')}
          />
        ) : null}
      </div>
    );
  }
  const btn = 'flex h-8 w-11 items-center justify-center text-muted hover:bg-surface-raised hover:text-text';
  return (
    <div className="flex items-center">
      <button type="button" aria-label={t('window.minimize')} onClick={onMinimize} className={btn}>
        <Minus size={14} />
      </button>
      {onMaximize ? (
        <button type="button" aria-label={t('window.maximize')} onClick={onMaximize} className={btn}>
          <Square size={12} />
        </button>
      ) : null}
      <button
        type="button"
        aria-label={t('window.close')}
        onClick={onClose}
        className={cn(btn, 'hover:bg-danger hover:text-inverse')}
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ── EmptyState ──
export function EmptyState({ title, hint, children }: { title: string; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <Orb size={40} state="idle" />
      <div className="text-sm font-medium">{title}</div>
      {hint ? <div className="max-w-72 text-xs text-subtle">{hint}</div> : null}
      {children}
    </div>
  );
}
