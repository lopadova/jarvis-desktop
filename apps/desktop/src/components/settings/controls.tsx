/** Settings controls (handoff `Settings.dc.html`): Row/Section, PermissionLevelControl (R1), ShortcutRecorder, PairingQR. */
import { Check, Info, type LucideIcon, Shield, ShieldAlert, ShieldCheck, TriangleAlert } from 'lucide-react';
import QRCode from 'qrcode';
import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { type MessageKey, useT } from '../../i18n';
import { cn } from '../../lib/cn';
import type { PermissionLevel, Platform, RelayState } from '../../types/ui';
import { KeyHint, Segmented } from '../common/common';

// ── Section / Row ──
export function Section({
  title,
  danger,
  children,
  className,
}: {
  title?: string;
  danger?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn('flex flex-col [&>.row:first-of-type]:border-t-0', className)}
      style={
        danger
          ? {
              padding: '14px 16px 4px',
              borderRadius: 14,
              border: '1px solid color-mix(in oklab, var(--color-danger) 60%, transparent)',
              background: 'color-mix(in oklab, var(--color-danger) 5%, transparent)',
            }
          : undefined
      }
    >
      {title ? (
        <h2
          className="m-0 mb-1 text-[12px] font-semibold tracking-[.06em] uppercase"
          style={{ color: danger ? 'var(--color-danger)' : 'var(--color-text-subtle)' }}
        >
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

export function Row({
  label,
  desc,
  icon: I,
  iconColor,
  note,
  noteColor,
  noteIcon: NoteIcon = Info,
  children,
  className,
  style,
}: {
  label: ReactNode;
  desc?: ReactNode;
  icon?: LucideIcon;
  iconColor?: string;
  note?: ReactNode;
  noteColor?: string;
  noteIcon?: LucideIcon;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={cn('row flex flex-wrap items-center gap-4 border-t border-border py-3', className)} style={style}>
      <div className="flex min-w-[180px] flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-[13.5px] font-[550] text-text">
          {I ? <I size={15} aria-hidden="true" style={{ color: iconColor ?? 'var(--color-text-muted)' }} /> : null}
          {label}
        </span>
        {desc ? <span className="text-pretty text-[12.5px] leading-[1.45] text-muted">{desc}</span> : null}
        {note ? (
          <span
            className="mt-0.5 flex items-center gap-[5px] text-[12px]"
            style={{ color: noteColor ?? 'var(--color-text-subtle)' }}
          >
            <NoteIcon size={12} aria-hidden="true" />
            {note}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export const fieldClass =
  'h-8 rounded-[8px] border border-border-strong bg-surface-raised px-2.5 font-sans text-[13px] text-text outline-none focus:border-accent';

export const outlineBtn = (danger?: boolean) =>
  cn(
    'h-8 cursor-pointer rounded-[8px] border bg-transparent px-3 text-[12.5px] font-semibold whitespace-nowrap disabled:cursor-default disabled:opacity-45',
    danger ? 'border-danger text-danger' : 'border-border-strong text-text',
  );

export const primaryBtn =
  'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] border-0 bg-accent px-3 text-[12.5px] font-semibold text-accent-contrast disabled:cursor-default disabled:opacity-45';

// ── PermissionLevelControl ── Full auto needs an explicit, checked confirmation (R1).
const LEVELS: { id: PermissionLevel; icon: LucideIcon }[] = [
  { id: 'safe', icon: Shield },
  { id: 'trusted', icon: ShieldCheck },
  { id: 'full-auto', icon: ShieldAlert },
];

export function PermissionLevelControl({
  value,
  onChange,
  label,
  project,
}: {
  value: PermissionLevel;
  onChange(level: PermissionLevel): void;
  label: string;
  project: string;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const pick = (level: PermissionLevel) => {
    if (level === value) return;
    if (level === 'full-auto') setConfirming(true);
    else onChange(level);
  };
  return (
    <>
      <Segmented
        label={label}
        value={value}
        onChange={pick}
        options={LEVELS.map(({ id, icon }) => ({
          value: id,
          icon,
          danger: id === 'full-auto',
          label: t(`permission.${id}` as MessageKey),
        }))}
      />
      {confirming ? (
        <FullAutoConfirm
          project={project}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onChange('full-auto');
          }}
        />
      ) : null}
    </>
  );
}

function FullAutoConfirm({ project, onCancel, onConfirm }: { project: string; onCancel(): void; onConfirm(): void }) {
  const t = useT();
  const [understood, setUnderstood] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => cancelRef.current?.focus({ preventScroll: true }), []);
  return (
    // The overlay covers the Settings window card (absolute inside the frame).
    <div className="absolute inset-0 z-[5] grid place-items-center bg-overlay">
      <div
        role="alertdialog"
        aria-modal="true"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
        aria-labelledby={titleId}
        className="flex w-[420px] max-w-[calc(100%-32px)] flex-col gap-[14px] rounded-[18px] border border-danger bg-surface-raised p-[22px] shadow-lg"
      >
        <span
          className="grid h-10 w-10 place-items-center rounded-[12px] text-danger"
          style={{ background: 'color-mix(in oklab, var(--color-danger) 15%, transparent)' }}
        >
          <ShieldAlert size={20} aria-hidden="true" />
        </span>
        <h2 id={titleId} className="m-0 text-[17px] font-[650] tracking-[-0.01em]">
          {t('permission.confirm.title', { project })}
        </h2>
        <p className="text-pretty m-0 text-[13.5px] leading-[1.55] text-muted">{t('permission.confirm.body')}</p>
        <label className="flex cursor-pointer items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={understood}
            onChange={() => setUnderstood((u) => !u)}
            className="m-0 h-4 w-4"
            style={{ accentColor: 'var(--color-danger)' }}
          />
          {t('permission.confirm.check')}
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="h-9 cursor-pointer rounded-[10px] border border-border-strong bg-surface px-[14px] text-[13px] font-semibold text-text"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!understood}
            className="h-9 rounded-[10px] border-0 bg-danger px-[14px] text-[13px] font-semibold text-inverse"
            style={{ cursor: understood ? 'pointer' : 'not-allowed', opacity: understood ? 1 : 0.45 }}
          >
            {t('permission.confirm.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ShortcutRecorder ──
const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta']);

/** Convert a keyboard event to a Tauri accelerator ("CommandOrControl+Shift+J"), or null if only modifiers. */
export function accelFromEvent(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  platform: Platform,
): string | null {
  if (MODIFIERS.has(e.key)) return null;
  const parts: string[] = [];
  const primary = platform === 'mac' ? e.metaKey : e.ctrlKey;
  if (primary) parts.push('CommandOrControl');
  if (platform === 'mac' && e.ctrlKey) parts.push('Control');
  if (platform !== 'mac' && e.metaKey) parts.push('Super');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let key = e.code;
  if (key.startsWith('Key')) key = key.slice(3);
  else if (key.startsWith('Digit')) key = key.slice(5);
  if (parts.length === 0 && !/^F\d{1,2}$/.test(key)) return null; // require a modifier unless it's a function key
  parts.push(key);
  return parts.join('+');
}

/** A settings row with a keycap recorder: idle (dashed) · recording · conflict · saved. */
export function ShortcutRow({
  label,
  desc,
  value,
  platform,
  conflict,
  onChange,
}: {
  label: string;
  desc?: string;
  value: string;
  platform: Platform;
  conflict?: boolean;
  onChange(accel: string): void;
}) {
  const t = useT();
  const [recording, setRecording] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 2200);
    return () => clearTimeout(id);
  }, [saved]);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    e.preventDefault();
    if (e.key === 'Escape') {
      setRecording(false);
      return;
    }
    const accel = accelFromEvent(e, platform);
    if (accel) {
      setRecording(false);
      setSaved(true);
      onChange(accel);
    }
  };
  const note = conflict ? t('shortcut.conflict') : saved ? t('shortcut.saved') : undefined;
  return (
    <Row
      label={label}
      desc={desc}
      note={note}
      noteColor={conflict ? 'var(--color-warning)' : 'var(--color-success)'}
      noteIcon={conflict ? TriangleAlert : Check}
    >
      <button
        type="button"
        aria-label={t('shortcut.change', { name: label })}
        onClick={() => setRecording((r) => !r)}
        onKeyDown={onKeyDown}
        onBlur={() => setRecording(false)}
        className="flex h-[34px] min-w-[120px] cursor-pointer items-center justify-end gap-1 rounded-[9px] px-2"
        style={{
          background: recording ? 'var(--color-accent-soft)' : 'transparent',
          border: `1px ${recording ? 'solid var(--color-accent)' : conflict ? 'solid var(--color-warning)' : 'dashed var(--color-border-strong)'}`,
        }}
      >
        {recording ? (
          <span className="text-[12.5px] font-semibold text-accent">{t('shortcut.recording')}</span>
        ) : (
          <KeyHint keys={value.split('+')} platform={platform} />
        )}
      </button>
    </Row>
  );
}

// ── PairingQR ──
export function PairingQR({ relay }: { relay: RelayState }) {
  const t = useT();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!relay.qr) {
      setSrc(null);
      return;
    }
    QRCode.toDataURL(relay.qr, { margin: 0, errorCorrectionLevel: 'M', width: 264, color: { dark: '#111111' } })
      .then((s) => alive && setSrc(s))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [relay.qr]);
  const waiting = relay.status === 'connecting';
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="grid h-[152px] w-[152px] place-items-center rounded-[12px] bg-white p-2.5 transition-opacity duration-200"
        style={{ opacity: waiting || relay.status === 'connected' ? 1 : 0.35 }}
      >
        {src ? (
          <img src={src} alt={t('relay.qr')} width={132} height={132} className="block" />
        ) : (
          <span className="px-2 text-center text-[11.5px] text-[#555]">{t('relay.noCode')}</span>
        )}
      </div>
      {relay.code ? (
        <span className="font-mono text-[16px] font-semibold tracking-[.12em]" data-selectable>
          {relay.code}
        </span>
      ) : null}
    </div>
  );
}
