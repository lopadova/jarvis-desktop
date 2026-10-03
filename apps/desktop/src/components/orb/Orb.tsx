/**
 * The Orb (brief §2): pure CSS, animates only transform/opacity. Idle breathing pauses when the
 * document is hidden (globals.css `html[data-hidden]`) and under reduced motion.
 */
import type { CSSProperties } from 'react';
import { cn } from '../../lib/cn';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'approval' | 'error' | 'private' | 'muted';
export type OrbSize = 16 | 24 | 40 | 64 | 96 | 160;

export interface OrbProps {
  size?: OrbSize;
  state?: OrbState;
  /** 0..1 mic (listening) or TTS (speaking) level. */
  level?: number;
  privateMode?: boolean;
  animated?: boolean;
  className?: string;
  label?: string;
}

export function Orb({
  size = 40,
  state = 'idle',
  level = 0,
  privateMode = false,
  animated = true,
  className,
  label,
}: OrbProps) {
  const lv = Math.max(0, Math.min(1, level));
  const reactive = state === 'listening' || state === 'speaking';
  const glowScale = reactive ? 1 + lv * 0.2 : 1;
  const core =
    state === 'approval'
      ? 'var(--color-ember)'
      : state === 'error'
        ? 'var(--color-danger)'
        : state === 'muted'
          ? 'var(--color-text-subtle)'
          : 'var(--orb-core)';
  const style: CSSProperties = { width: size, height: size };
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is "img" whenever aria-label is set; otherwise the orb is aria-hidden decoration.
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('relative inline-block shrink-0', className)}
      style={style}
      data-state={state}
    >
      {/* glow */}
      <span
        className="absolute inset-[-14%] rounded-full blur-sm transition-transform duration-75"
        style={{
          background: `radial-gradient(circle, ${state === 'approval' ? 'var(--color-ember)' : 'var(--orb-glow)'} 0%, transparent 70%)`,
          transform: `scale(${glowScale})`,
          animation: animated && state === 'idle' ? 'orb-breathe 4s ease-in-out infinite' : undefined,
          opacity: state === 'muted' ? 0.2 : undefined,
        }}
      />
      {/* core */}
      <span
        className="absolute inset-0 overflow-hidden rounded-full"
        style={{
          background: `radial-gradient(circle at 35% 30%, white 0%, ${core} 45%, color-mix(in oklch, ${core} 60%, black) 100%)`,
          animation: animated && state === 'error' ? 'orb-shake 300ms ease-in-out 2' : undefined,
        }}
      >
        {state === 'thinking' && animated ? (
          <span
            className="absolute inset-0"
            style={{
              background: 'conic-gradient(from 0deg, transparent 0 60%, rgb(255 255 255 / 0.55) 80%, transparent 100%)',
              animation: 'orb-sweep 1.6s linear infinite',
            }}
          />
        ) : null}
      </span>
      {/* rings: listening waveform / private / error */}
      {state === 'listening' ? (
        <span
          className="absolute inset-[-12%] rounded-full border-2 transition-transform duration-75"
          style={{ borderColor: 'var(--orb-ring)', transform: `scale(${1 + lv * 0.12})` }}
        />
      ) : null}
      {state === 'error' ? <span className="absolute inset-[-8%] rounded-full border-2 border-danger" /> : null}
      {privateMode || state === 'private' ? (
        <span className="absolute inset-[-6%] rounded-full border border-private" data-testid="orb-private-ring" />
      ) : null}
    </span>
  );
}
