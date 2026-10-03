/**
 * The Orb (brief §2, handoff `Orb.dc.html`): pure CSS, animates only transform/opacity.
 * Idle breathing / thinking sweep pause when the document is hidden and under reduced motion.
 */
import type { CSSProperties } from 'react';
import { useMotion } from '../../lib/motion';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'approval' | 'error' | 'private' | 'muted';
/** Design sizes are 16/24/40/64/96/160; other sizes (e.g. 56 in the empty state) also work. */
export type OrbSize = number;

export interface OrbProps {
  size?: OrbSize;
  state?: OrbState;
  /** 0..1 mic (listening) or TTS (speaking) level. */
  level?: number;
  privateMode?: boolean;
  animated?: boolean;
  className?: string;
  /** Accessible label; without it the orb is decorative (aria-hidden). */
  label?: string;
}

const CORE_DEFAULT =
  'radial-gradient(circle at 35% 30%, #ffffff 0%, var(--orb-core) 22%, var(--color-accent) 60%, oklch(0.3 0.1 var(--accent-hue)) 100%)';
const CORE_SPEAKING =
  'radial-gradient(circle at 35% 30%, #fff8ec 0%, #ffd08a 22%, var(--color-ember) 58%, #7a3608 100%)';
const CORE_MUTED = 'radial-gradient(circle at 35% 30%, #f1f2f5 0%, #a3a9b5 40%, #4b515d 100%)';

export function Orb({
  size = 40,
  state = 'idle',
  level = 0,
  privateMode = false,
  animated = true,
  className,
  label,
}: OrbProps) {
  const motionOk = useMotion();
  const anim = animated && motionOk;
  const s = size;
  const st = state === 'private' ? 'idle' : state;
  const priv = privateMode || state === 'private';
  const lv = Math.max(0, Math.min(1, level));
  const reactive = st === 'listening' || st === 'speaking';
  const tr = anim ? 'transform 90ms linear, opacity 90ms linear' : 'none';
  const bw = Math.max(1.5, s * 0.035);

  const glowCol =
    st === 'muted'
      ? 'rgba(160,166,178,.25)'
      : st === 'speaking'
        ? 'rgba(246,169,74,.55)'
        : st === 'error'
          ? 'rgba(255,114,114,.35)'
          : st === 'approval'
            ? 'rgba(245,189,79,.5)'
            : 'var(--orb-glow)';
  const glowOpacity = st === 'muted' ? 0.5 : reactive ? 0.55 + lv * 0.45 : 0.75;

  const wrap: CSSProperties = {
    position: 'relative',
    width: s,
    height: s,
    flexShrink: 0,
    display: 'inline-block',
    animation: st === 'error' && anim ? 'jv-shake .45s ease-in-out 1' : 'none',
  };
  const glow: CSSProperties = {
    position: 'absolute',
    inset: -s * 0.35,
    borderRadius: '50%',
    background: `radial-gradient(circle, ${glowCol} 0%, transparent 65%)`,
    opacity: glowOpacity,
    transform: reactive ? `scale(${0.9 + lv * 0.25})` : undefined,
    transition: tr,
    animation: st === 'idle' && anim ? 'jv-breathe 4s ease-in-out infinite' : 'none',
    pointerEvents: 'none',
  };
  const ring = (scale: number, opacity: number, width: number): CSSProperties => ({
    position: 'absolute',
    inset: 0,
    borderRadius: '50%',
    border: `${width}px solid var(--orb-ring)`,
    transform: `scale(${scale})`,
    opacity,
    transition: tr,
  });
  const haloCol = st === 'approval' ? 'var(--color-warning)' : 'var(--color-danger)';
  const core: CSSProperties = {
    position: 'absolute',
    inset: 0,
    borderRadius: '50%',
    background: st === 'muted' ? CORE_MUTED : st === 'speaking' ? CORE_SPEAKING : CORE_DEFAULT,
    overflow: 'hidden',
    boxShadow: `inset 0 -${s * 0.06}px ${s * 0.14}px rgba(0,0,0,.35), inset 0 ${s * 0.03}px ${s * 0.06}px rgba(255,255,255,.35)`,
    transform: reactive ? `scale(${1 + lv * (st === 'speaking' ? 0.1 : 0.07)})` : 'none',
    transition: tr,
    filter: st === 'error' ? 'saturate(.35)' : 'none',
  };

  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is "img" whenever aria-label is set; otherwise the orb is aria-hidden decoration.
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
      style={wrap}
      data-state={st}
    >
      <span style={glow} />
      {st === 'listening' ? (
        <>
          <span style={ring(1.3 + lv * 0.45, 0.12 + lv * 0.35, Math.max(1, bw * 0.6))} />
          <span style={ring(1.14 + lv * 0.22, 0.35 + lv * 0.55, bw)} />
        </>
      ) : null}
      {st === 'approval' || st === 'error' ? (
        <span
          style={{
            position: 'absolute',
            inset: -s * 0.1,
            borderRadius: '50%',
            border: `${bw}px solid ${haloCol}`,
            boxShadow: `0 0 ${s * 0.25}px ${st === 'approval' ? 'rgba(245,189,79,.45)' : 'rgba(255,114,114,.3)'}`,
          }}
        />
      ) : null}
      {priv ? (
        <span
          data-testid="orb-private-ring"
          style={{
            position: 'absolute',
            inset: -s * (st === 'approval' || st === 'error' ? 0.2 : 0.1),
            borderRadius: '50%',
            border: `${Math.max(1, bw * 0.7)}px solid var(--color-private)`,
          }}
        />
      ) : null}
      <span style={core}>
        {st === 'thinking' ? (
          <span
            style={{
              position: 'absolute',
              inset: '-20%',
              background:
                'conic-gradient(from 0deg, transparent 0deg, rgba(255,255,255,.7) 50deg, transparent 120deg, transparent 200deg, rgba(255,255,255,.35) 250deg, transparent 320deg)',
              mixBlendMode: 'overlay',
              animation: anim ? 'jv-spin 1.6s linear infinite' : 'none',
            }}
          />
        ) : null}
        <span
          style={{
            position: 'absolute',
            left: '18%',
            top: '12%',
            width: '34%',
            height: '24%',
            borderRadius: '50%',
            background: 'radial-gradient(ellipse, rgba(255,255,255,.75), transparent 70%)',
            opacity: st === 'muted' ? 0.5 : 0.9,
          }}
        />
      </span>
    </span>
  );
}
