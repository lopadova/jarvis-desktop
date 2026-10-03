/** Root: picks the surface from the hash route, applies theme/material, connects the store. */
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LocaleProvider, useT } from './i18n';
import { createTransport, isMockMode } from './ipc/connection';
import { detectPlatform, modelStatus, onShellEvent, SHELL_EVENTS, shellInfo } from './lib/tauri';
import { useApp } from './store/app';
import { HomeSurface, OnboardingSurface, PillSurface, SessionsSurface, SettingsSurface } from './surfaces/Surfaces';
import type { Material, ModelStatus, Platform } from './types/ui';

export type Surface = 'pill' | 'sessions' | 'home' | 'settings' | 'onboarding';

export function surfaceFromHash(hash: string): Surface {
  const route = hash.replace(/^#\/?/, '').split('?')[0];
  return (['pill', 'sessions', 'home', 'settings', 'onboarding'] as const).find((s) => s === route) ?? 'home';
}

function useSurface(): Surface {
  const [surface, setSurface] = useState(() => surfaceFromHash(location.hash));
  useEffect(() => {
    const on = () => setSurface(surfaceFromHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return surface;
}

function useAppearance(surface: Surface, osMaterial: Material) {
  const theme = useApp((s) => s.settings.theme);
  const material = useApp((s) => s.settings.material);
  const accentHue = useApp((s) => s.settings.accentHue);
  const locale = useApp((s) => s.settings.locale);
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia?.('(prefers-color-scheme: light)');
    const reduceTransparency = window.matchMedia?.('(prefers-reduced-transparency: reduce)').matches ?? false;
    const apply = () => {
      root.dataset.theme = theme === 'system' ? (media?.matches ? 'light' : 'dark') : theme;
    };
    apply();
    const wanted = material === 'auto' ? osMaterial : material;
    // "glass" only when the OS really draws a material behind the window; otherwise solid (brief §3).
    root.dataset.material = reduceTransparency || osMaterial === 'solid' ? 'solid' : wanted;
    root.dataset.surface = surface;
    root.style.setProperty('--accent-hue', String(accentHue));
    root.lang = locale;
    media?.addEventListener?.('change', apply);
    return () => media?.removeEventListener?.('change', apply);
  }, [theme, material, accentHue, locale, surface, osMaterial]);
}

function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  const t = useT();
  useEffect(() => {
    if (toasts.length === 0) return;
    const first = toasts[0];
    const id = setTimeout(() => first && dismiss(first.id), 6000);
    return () => clearTimeout(id);
  }, [toasts, dismiss]);
  if (toasts.length === 0) return null;
  return (
    <ol
      aria-live="polite"
      className="fixed right-4 bottom-4 z-50 flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-2"
    >
      {toasts.map((toast) => (
        <li
          key={toast.id}
          role={toast.level === 'error' ? 'alert' : 'status'}
          className="flex items-start gap-2 rounded-lg border border-border bg-surface-raised p-3 text-sm shadow-md"
        >
          <span
            className={
              toast.level === 'error'
                ? 'text-danger'
                : toast.level === 'warning'
                  ? 'text-warning'
                  : toast.level === 'success'
                    ? 'text-success'
                    : 'text-info'
            }
          >
            ●
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium">{toast.title}</div>
            {toast.body ? <div className="text-xs text-muted">{toast.body}</div> : null}
          </div>
          <button
            type="button"
            aria-label={t('common.dismiss')}
            onClick={() => dismiss(toast.id)}
            className="text-subtle hover:text-text"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ol>
  );
}

export function App() {
  const surface = useSurface();
  const [platform, setPlatform] = useState<Platform>(detectPlatform);
  const [osMaterial, setOsMaterial] = useState<Material>('solid');
  const locale = useApp((s) => s.settings.locale);
  const connection = useApp((s) => s.connection);

  useEffect(() => useApp.getState().connect(createTransport()), []);

  useEffect(() => {
    void shellInfo().then((info) => {
      if (!info) return;
      setPlatform(info.platform);
      setOsMaterial(info.material);
    });
    void modelStatus().then((m) => useApp.getState().setModels(m));
    const offs: Promise<() => void>[] = [
      onShellEvent<ModelStatus[]>(SHELL_EVENTS.models, (m) => useApp.getState().setModels(m)),
      onShellEvent<{ level: number }>(SHELL_EVENTS.micLevel, (e) => useApp.getState().setMicLevel(e.level)),
      onShellEvent<{ pressed: boolean }>(SHELL_EVENTS.pushToTalk, (e) => useApp.getState().setPushToTalk(e.pressed)),
      onShellEvent<{ open: boolean }>(SHELL_EVENTS.micOpen, (e) => useApp.getState().setMicOpen(e.open)),
    ];
    return () => {
      for (const o of offs) void o.then((f) => f());
    };
  }, []);

  // In mock mode (browser) there is no OS material; allow previewing glass via ?material=glass.
  const settingsMaterial = useApp((s) => s.settings.material);
  useAppearance(surface, isMockMode() && settingsMaterial === 'glass' ? 'glass' : osMaterial);

  return (
    <LocaleProvider locale={locale}>
      {surface === 'pill' ? <PillSurface platform={platform} /> : null}
      {surface === 'sessions' ? <SessionsSurface /> : null}
      {surface === 'home' ? <HomeSurface platform={platform} /> : null}
      {surface === 'settings' ? <SettingsSurface platform={platform} /> : null}
      {surface === 'onboarding' ? <OnboardingSurface platform={platform} /> : null}
      {surface !== 'pill' && surface !== 'sessions' ? <Toasts /> : null}
      {surface !== 'pill' && surface !== 'sessions' ? (
        <ConnectionBanner connection={connection} mock={isMockMode()} />
      ) : null}
    </LocaleProvider>
  );
}

function ConnectionBanner({ connection, mock }: { connection: string; mock: boolean }) {
  const t = useT();
  if (mock)
    return (
      <div className="fixed top-1 left-1/2 -translate-x-1/2 rounded-pill bg-surface-raised px-2 py-0.5 text-xs text-subtle">
        {t('app.mock')}
      </div>
    );
  if (connection === 'open') return null;
  return (
    <div
      role="status"
      className="fixed top-1 left-1/2 -translate-x-1/2 rounded-pill bg-warning px-3 py-0.5 text-xs text-inverse"
    >
      {t('app.reconnecting')}
    </div>
  );
}
