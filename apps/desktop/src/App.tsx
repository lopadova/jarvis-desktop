/** Root: picks the surface from the hash route, applies theme/material, connects the store. */
import { lazy, Suspense, useEffect, useState } from 'react';
import { LocaleProvider, useT } from './i18n';
import { createTransport, isMockMode } from './ipc/connection';
import { detectPlatform, modelStatus, onShellEvent, SHELL_EVENTS, shellInfo } from './lib/tauri';
import { useApp } from './store/app';
import { HomeSurface, PillSurface, SessionsSurface } from './surfaces/Surfaces';
import type { Material, ModelStatus, Platform } from './types/ui';

// Heavy, rarely-open windows are code-split out of the main chunk.
const SettingsSurface = lazy(() => import('./surfaces/SettingsSurface'));
const OnboardingSurface = lazy(() => import('./surfaces/OnboardingSurface'));

/** Browser preview may force a platform with ?platform=mac|win|linux (window chrome QA). */
function previewPlatform(): Platform {
  const q = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('platform');
  return q === 'mac' || q === 'win' || q === 'linux' ? q : detectPlatform();
}

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
    // Browser preview: show windows at their design size on the design wallpaper.
    root.dataset.desk = isMockMode() ? 'true' : 'false';
    root.style.setProperty('--accent-hue', String(accentHue));
    root.lang = locale;
    media?.addEventListener?.('change', apply);
    return () => media?.removeEventListener?.('change', apply);
  }, [theme, material, accentHue, locale, surface, osMaterial]);
}

export function App() {
  const surface = useSurface();
  const [platform, setPlatform] = useState<Platform>(previewPlatform);
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
      <Suspense fallback={null}>
        {surface === 'settings' ? <SettingsSurface platform={platform} /> : null}
        {surface === 'onboarding' ? <OnboardingSurface platform={platform} /> : null}
      </Suspense>
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
      <div className="fixed bottom-2 left-1/2 -translate-x-1/2 rounded-pill bg-surface-raised px-2.5 py-0.5 text-[11px] text-subtle shadow-sm">
        {t('app.mock')}
      </div>
    );
  if (connection === 'open') return null;
  return (
    <div
      role="status"
      className="fixed top-1 left-1/2 z-50 -translate-x-1/2 rounded-pill bg-warning px-3 py-0.5 text-[11.5px] font-semibold text-inverse"
    >
      {t('app.reconnecting')}
    </div>
  );
}
