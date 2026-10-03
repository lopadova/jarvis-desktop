/**
 * The window "card" of a frameless, transparent Tauri window: rounded corners per platform, border,
 * surface + glass. Inside Tauri it fills the window; in the browser preview (`html[data-desk]`) it is
 * shown at its design size on the wallpaper (see globals.css).
 */
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import type { Platform } from '../../types/ui';

export const windowRadius = (platform: Platform, onboarding = false) =>
  onboarding ? (platform === 'mac' ? 14 : 10) : platform === 'win' ? 8 : 12;

export function WindowFrame({
  platform,
  width,
  height,
  onboarding,
  className,
  children,
  role,
  label,
}: {
  platform: Platform;
  width: number;
  height: number;
  onboarding?: boolean;
  className?: string;
  children: ReactNode;
  role?: 'dialog';
  label?: string;
}) {
  return (
    <div
      {...(role ? { role, 'aria-label': label } : {})}
      data-window
      className={cn(
        'window-frame glass relative flex flex-col overflow-hidden border border-border bg-surface font-sans text-text shadow-lg',
        className,
      )}
      style={
        {
          '--win-w': `${width + 2}px`,
          '--win-h': `${height + 2}px`,
          borderRadius: windowRadius(platform, onboarding),
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}
