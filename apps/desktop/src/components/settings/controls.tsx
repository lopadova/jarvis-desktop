/** Settings controls: PermissionLevelControl (R1), ShortcutRecorder, PairingQR. */
import { Shield, ShieldAlert, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';
import { type KeyboardEvent, useEffect, useState } from 'react';
import { type MessageKey, useT } from '../../i18n';
import { cn } from '../../lib/cn';
import type { PermissionLevel, Platform, RelayState } from '../../types/ui';
import { KeyHint } from '../common/common';
import { Button } from '../ui/button';
import { Badge, Dialog, DialogClose, DialogContent } from '../ui/primitives';

// ── PermissionLevelControl ──
const LEVELS: { id: PermissionLevel; icon: typeof Shield }[] = [
  { id: 'safe', icon: Shield },
  { id: 'trusted', icon: ShieldCheck },
  { id: 'full-auto', icon: ShieldAlert },
];

export function PermissionLevelControl({
  value,
  onChange,
  label,
}: {
  value: PermissionLevel;
  onChange(level: PermissionLevel): void;
  label: string;
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
      <div
        role="radiogroup"
        aria-label={label}
        className="inline-flex rounded-md border border-border bg-surface-sunken p-0.5"
      >
        {LEVELS.map(({ id, icon: I }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={value === id}
            onClick={() => pick(id)}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-sm px-2 text-xs',
              value === id
                ? id === 'full-auto'
                  ? 'bg-danger text-inverse'
                  : 'bg-surface-raised text-text shadow-sm'
                : 'text-muted hover:text-text',
            )}
          >
            <I size={12} aria-hidden="true" />
            {t(`permission.${id}` as MessageKey)}
          </button>
        ))}
      </div>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent
          role="alertdialog"
          title={t('permission.confirm.title')}
          description={t('permission.confirm.body')}
        >
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button autoFocus>{t('common.cancel')}</Button>
            </DialogClose>
            <Button
              variant="danger"
              onClick={() => {
                setConfirming(false);
                onChange('full-auto');
              }}
            >
              {t('permission.confirm.ok')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
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

export function ShortcutRecorder({
  value,
  platform,
  conflict,
  onChange,
  label,
}: {
  value: string;
  platform: Platform;
  conflict?: boolean;
  onChange(accel: string): void;
  label: string;
}) {
  const t = useT();
  const [recording, setRecording] = useState(false);
  const [saved, setSaved] = useState(false);
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
  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 1500);
    return () => clearTimeout(id);
  }, [saved]);
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={label}
        onClick={() => setRecording((r) => !r)}
        onKeyDown={onKeyDown}
        onBlur={() => setRecording(false)}
        className={cn(
          'flex h-8 min-w-36 items-center justify-center rounded-md border px-2',
          recording ? 'border-accent bg-accent-soft' : conflict ? 'border-warning' : 'border-border bg-surface-sunken',
        )}
      >
        {recording ? (
          <span className="text-xs text-accent">{t('shortcut.recording')}</span>
        ) : (
          <KeyHint keys={value.split('+')} platform={platform} />
        )}
      </button>
      {conflict ? (
        <Badge tone="warning">{t('shortcut.conflict')}</Badge>
      ) : saved ? (
        <Badge tone="success">{t('shortcut.saved')}</Badge>
      ) : null}
    </div>
  );
}

// ── PairingQR ──
export function PairingQR({ relay }: { relay: RelayState }) {
  const t = useT();
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!relay.qr) {
      setSvg(null);
      return;
    }
    QRCode.toDataURL(relay.qr, { margin: 1, errorCorrectionLevel: 'M', width: 256 })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(null));
    return () => {
      alive = false;
    };
  }, [relay.qr]);
  const tone = relay.status === 'connected' ? 'success' : relay.status === 'offline' ? 'danger' : 'neutral';
  return (
    <div className="flex items-center gap-4">
      {svg ? <img src={svg} alt={t('relay.qr')} className="h-32 w-32 rounded-md bg-white p-1" /> : null}
      <div className="flex flex-col gap-2">
        <Badge tone={tone}>{t(`relay.status.${relay.status}` as MessageKey)}</Badge>
        {relay.code ? (
          <div>
            <div className="text-xs text-subtle">{t('relay.code')}</div>
            <div className="font-mono text-xl tracking-[0.2em]" data-selectable>
              {relay.code}
            </div>
          </div>
        ) : null}
        {relay.error ? <div className="text-xs text-danger">{relay.error}</div> : null}
      </div>
    </div>
  );
}
