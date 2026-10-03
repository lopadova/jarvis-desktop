/**
 * Shared components from brief §6 (handoff values): AgentMark, ProviderTile, StatusChip, UsageMeter,
 * KeyHint, WindowControls, EmptyState, Switch, Segmented, Toast.
 */
import {
  Braces,
  CircleCheck,
  CircleX,
  Cpu,
  Info,
  KeyRound,
  type LucideIcon,
  MessageCircle,
  Minus,
  Square,
  Terminal,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { type MessageKey, useT } from '../../i18n';
import { cn } from '../../lib/cn';
import type { AgentId, BrainId, Platform, ToastLevel } from '../../types/ui';
import { Orb } from '../orb/Orb';

// ── AgentMark ── original simple glyphs (no third-party logos; official ones go in reserved slots).
export const AGENT_MARKS: Record<AgentId, { glyph: string; bg: string }> = {
  claude: { glyph: 'Cl', bg: 'oklch(0.6 0.13 45)' },
  codex: { glyph: 'Cx', bg: 'oklch(0.48 0.04 260)' },
  home: { glyph: 'J', bg: 'oklch(0.55 0.12 var(--accent-hue))' },
};

export function AgentMark({
  id,
  size = 30,
  radius,
  fontSize,
  className,
}: {
  id: AgentId;
  size?: number;
  radius?: number;
  fontSize?: number;
  className?: string;
}) {
  const m = AGENT_MARKS[id] ?? AGENT_MARKS.home;
  return (
    <span
      aria-hidden="true"
      className={cn('inline-grid shrink-0 place-items-center font-sans font-bold text-white', className)}
      style={{
        width: size,
        height: size,
        borderRadius: radius ?? Math.round(size * 0.27),
        fontSize: fontSize ?? size * 0.38,
        background: m.bg,
      }}
    >
      {m.glyph}
    </span>
  );
}

// ── ProviderTile ── brain/provider tile (settings accounts, onboarding brain cards).
export const PROVIDER_TILES: Record<BrainId, { icon: LucideIcon; bg: string }> = {
  chatgpt: { icon: MessageCircle, bg: 'oklch(0.6 0.1 160)' },
  claude: { icon: Terminal, bg: 'oklch(0.6 0.13 45)' },
  codex: { icon: Braces, bg: 'oklch(0.48 0.04 260)' },
  'api-anthropic': { icon: KeyRound, bg: 'oklch(0.5 0.03 60)' },
  'api-openai': { icon: KeyRound, bg: 'oklch(0.5 0.04 260)' },
  local: { icon: Cpu, bg: 'var(--color-private)' },
};

export function ProviderTile({ id, icon, bg }: { id?: BrainId; icon?: LucideIcon; bg?: string }) {
  const def = id ? PROVIDER_TILES[id] : undefined;
  const I = icon ?? def?.icon ?? KeyRound;
  return (
    <span
      aria-hidden="true"
      className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] text-white"
      style={{ background: bg ?? def?.bg }}
    >
      <I size={16} />
    </span>
  );
}

export const brainKey = (id: BrainId): MessageKey => `brain.${id}` as MessageKey;

// ── StatusChip ── coloured pill: text + 14 % tint (color-mix) of the same colour.
export function chipStyle(color: string, height = 22): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    height,
    padding: '0 8px',
    borderRadius: 999,
    fontSize: height <= 20 ? 11 : 11.5,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    color,
    background: `color-mix(in oklab, ${color} 14%, transparent)`,
    flexShrink: 0,
  };
}

export function StatusChip({
  color,
  icon: I,
  children,
  height,
  className,
}: {
  color: string;
  icon?: LucideIcon;
  children: ReactNode;
  height?: number;
  className?: string;
}) {
  return (
    <span className={className} style={chipStyle(color, height)}>
      {I ? <I size={height && height <= 20 ? 11 : 12} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

// ── UsageMeter ── warning at 80 %, danger at 100 %.
export const usageColor = (pct: number) =>
  pct >= 100 ? 'var(--color-danger)' : pct >= 80 ? 'var(--color-warning)' : 'var(--color-accent)';

export function UsageBar({
  pct,
  label,
  height = 6,
  width,
}: {
  pct: number;
  label: string;
  height?: number;
  width?: number;
}) {
  const v = Math.max(0, Math.min(100, pct));
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v)}
      className="block overflow-hidden rounded-pill bg-surface-sunken"
      style={{ height, width }}
    >
      <span className="block h-full rounded-pill" style={{ width: `${v}%`, background: usageColor(v) }} />
    </span>
  );
}

// ── KeyHint ──
const MAC_KEYS: Record<string, string> = {
  CommandOrControl: '⌘',
  Command: '⌘',
  Cmd: '⌘',
  Super: '⌘',
  Meta: '⌘',
  Alt: '⌥',
  Option: '⌥',
  Shift: '⇧',
  Control: '⌃',
  Ctrl: '⌃',
  Escape: 'Esc',
};
const PC_KEYS: Record<string, string> = {
  CommandOrControl: 'Ctrl',
  Control: 'Ctrl',
  Command: 'Win',
  Super: 'Win',
  Meta: 'Win',
  Escape: 'Esc',
};

export function keyLabel(key: string, platform: Platform): string {
  return (platform === 'mac' ? MAC_KEYS[key] : PC_KEYS[key]) ?? key;
}

export function KeyHint({
  keys,
  platform,
  small,
  className,
}: {
  keys: string[];
  platform: Platform;
  small?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex', small ? 'gap-[3px]' : 'gap-1', className)}>
      {keys.map((k) => (
        <kbd key={k} className={cn('kbd', small && 'kbd-sm')}>
          {keyLabel(k, platform)}
        </kbd>
      ))}
    </span>
  );
}

// ── WindowControls ── mac traffic lights (left) · Windows caption buttons · Linux round buttons (right).
export type WindowAction = 'minimize' | 'maximize' | 'close';

export function MacLights({ onAction, closeOnly }: { onAction(a: WindowAction): void; closeOnly?: boolean }) {
  const t = useT();
  const dot = 'h-3 w-3 rounded-full border-0 p-0 cursor-pointer';
  return (
    <div className="flex gap-2">
      <button
        type="button"
        aria-label={t('window.close')}
        onClick={() => onAction('close')}
        className={cn(dot, 'bg-[#ff5f57]')}
      />
      {closeOnly ? (
        <>
          <span className="h-3 w-3 rounded-full bg-border-strong" />
          <span className="h-3 w-3 rounded-full bg-border-strong" />
        </>
      ) : (
        <>
          <button
            type="button"
            aria-label={t('window.minimize')}
            onClick={() => onAction('minimize')}
            className={cn(dot, 'bg-[#febc2e]')}
          />
          <button
            type="button"
            aria-label={t('window.maximize')}
            onClick={() => onAction('maximize')}
            className={cn(dot, 'bg-[#28c840]')}
          />
        </>
      )}
    </div>
  );
}

export function WinCaption({ onAction, maximize = true }: { onAction(a: WindowAction): void; maximize?: boolean }) {
  const t = useT();
  const btn =
    'grid w-[46px] place-items-center border-0 bg-transparent text-muted cursor-pointer hover:bg-surface-raised';
  return (
    <div className="flex self-stretch">
      <button type="button" aria-label={t('window.minimize')} onClick={() => onAction('minimize')} className={btn}>
        <Minus size={15} aria-hidden="true" />
      </button>
      {maximize ? (
        <button type="button" aria-label={t('window.maximize')} onClick={() => onAction('maximize')} className={btn}>
          <Square size={12} aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        aria-label={t('window.close')}
        onClick={() => onAction('close')}
        className={cn(btn, 'hover:bg-[#c42b1c] hover:text-white')}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

export function LinuxCaption({ onAction }: { onAction(a: WindowAction): void }) {
  const t = useT();
  const btn =
    'grid h-6 w-6 place-items-center rounded-full border-0 bg-surface-raised text-muted cursor-pointer hover:text-text';
  return (
    <div className="flex gap-2 pr-3">
      <button type="button" aria-label={t('window.minimize')} onClick={() => onAction('minimize')} className={btn}>
        <Minus size={12} aria-hidden="true" />
      </button>
      <button type="button" aria-label={t('window.close')} onClick={() => onAction('close')} className={btn}>
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
}

// ── EmptyState ──
export function EmptyState({
  title,
  hint,
  children,
  orbSize = 64,
  className,
}: {
  title: string;
  hint?: ReactNode;
  children?: ReactNode;
  orbSize?: number;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-[14px] text-center', className)}>
      <Orb size={orbSize} state="muted" animated={false} />
      <span className="text-[16px] font-semibold">{title}</span>
      {hint ? <span className="text-pretty max-w-[360px] text-[13.5px] leading-[1.5] text-muted">{hint}</span> : null}
      {children}
    </div>
  );
}

// ── Switch ── track 38×22, knob 16 (design); `green` for the private-mode switch.
export function Switch({
  checked,
  onCheckedChange,
  label,
  green,
  disabled,
}: {
  checked: boolean;
  onCheckedChange(v: boolean): void;
  label: string;
  green?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className="relative h-[22px] w-[38px] shrink-0 cursor-pointer rounded-pill border-0 p-0 transition-[background] duration-[160ms] disabled:cursor-default"
      style={{
        background: checked ? (green ? 'var(--color-private)' : 'var(--color-accent)') : 'var(--color-border-strong)',
      }}
    >
      <span
        className="absolute top-[3px] left-[3px] h-4 w-4 rounded-pill bg-white shadow-[0_1px_2px_rgba(0,0,0,.3)] transition-transform duration-[160ms] ease-standard"
        style={{ transform: checked ? 'translateX(16px)' : 'none' }}
      />
    </button>
  );
}

// ── Segmented ── radiogroup of pill buttons on a sunken track.
export interface SegOption<V extends string> {
  value: V;
  label: ReactNode;
  icon?: LucideIcon;
  danger?: boolean;
}

export function Segmented<V extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
}: {
  value: V | null;
  options: SegOption<V>[];
  onChange(v: V): void;
  label: string;
  size?: 'md' | 'lg';
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'flex border border-border bg-surface-sunken',
        size === 'lg' ? 'rounded-[10px] p-[3px]' : 'rounded-[10px] p-[3px]',
      )}
    >
      {options.map((o) => {
        const on = o.value === value;
        const I = o.icon;
        return (
          // biome-ignore lint/a11y/useSemanticElements: styled segmented control (role=radio inside role=radiogroup).
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex cursor-pointer items-center gap-1.5 border-0 font-semibold whitespace-nowrap',
              size === 'lg' ? 'h-[30px] rounded-[8px] px-[14px] text-[12.5px]' : 'h-7 rounded-[7px] px-3 text-[12.5px]',
              on
                ? o.danger
                  ? 'bg-danger text-inverse shadow-sm'
                  : 'bg-surface-raised text-text shadow-sm'
                : o.danger
                  ? 'bg-transparent text-danger'
                  : 'bg-transparent text-muted',
            )}
          >
            {I ? <I size={13} aria-hidden="true" /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Toast ──
const TOAST_META: Record<ToastLevel, { icon: LucideIcon; color: string }> = {
  info: { icon: Info, color: 'var(--color-accent)' },
  success: { icon: CircleCheck, color: 'var(--color-success)' },
  warning: { icon: TriangleAlert, color: 'var(--color-warning)' },
  error: { icon: CircleX, color: 'var(--color-danger)' },
};

export function Toast({
  level,
  title,
  body,
  action,
  onAction,
  onClose,
  className,
  style,
}: {
  level: ToastLevel;
  title: string;
  body?: string;
  action?: string;
  onAction?(): void;
  onClose?(): void;
  className?: string;
  style?: CSSProperties;
}) {
  const t = useT();
  const { icon: I, color } = TOAST_META[level];
  return (
    <div
      role={level === 'error' ? 'alert' : 'status'}
      className={cn(
        'box-border flex w-[360px] max-w-full items-start gap-3 rounded-[14px] border border-border-strong bg-surface-raised py-3 pr-3 pl-[14px] font-sans text-text shadow-lg',
        className,
      )}
      style={style}
    >
      <I size={17} aria-hidden="true" className="mt-px shrink-0" style={{ color }} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13.5px] font-semibold">{title}</span>
        {body ? <span className="text-[12.5px] leading-[1.45] text-muted">{body}</span> : null}
      </div>
      {action ? (
        <button
          type="button"
          onClick={onAction}
          className="h-7 cursor-pointer rounded-[7px] border-0 bg-accent-soft px-2.5 text-[12px] font-semibold text-text"
        >
          {action}
        </button>
      ) : null}
      {onClose ? (
        <button
          type="button"
          aria-label={t('common.dismiss')}
          onClick={onClose}
          className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-[6px] border-0 bg-transparent text-subtle hover:text-text"
        >
          <X size={13} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
