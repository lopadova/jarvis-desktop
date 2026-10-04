/**
 * Thin, optional bridge to the Tauri runtime. Everything degrades to no-ops in a plain browser
 * (mock mode), so the UI can be developed and tested without the Rust shell.
 */
import type { Material, ModelStatus, Platform } from '../types/ui';

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface SidecarEndpoint {
  port: number;
  token: string;
}

export interface ShellInfo {
  platform: Platform;
  material: Material;
  version: string;
}

/** Window labels created by the shell (src-tauri/src/surfaces.rs). */
export type WindowLabel = 'pill' | 'sessions' | 'home' | 'settings' | 'onboarding';

/** Events emitted by the Rust shell to the webviews. */
export const SHELL_EVENTS = {
  models: 'voice://models',
  micLevel: 'voice://level',
  micOpen: 'voice://mic',
  pushToTalk: 'voice://ptt',
  navigate: 'shell://navigate',
} as const;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args);
}

export async function sidecarEndpoint(): Promise<SidecarEndpoint> {
  return invoke<SidecarEndpoint>('sidecar_endpoint');
}

export async function shellInfo(): Promise<ShellInfo | null> {
  if (!isTauri()) return null;
  return invoke<ShellInfo>('shell_info');
}

export async function showWindow(label: WindowLabel, tab?: string): Promise<void> {
  if (!isTauri()) {
    // Browser preview: every surface is a hash route of the same page.
    if (typeof location !== 'undefined') location.hash = `#/${label}${tab ? `?tab=${tab}` : ''}`;
    return;
  }
  await invoke('show_window', { label, tab: tab ?? null });
}

/** Push-to-talk from the Home composer mic button (press = start capture, release = stop). */
export async function pushToTalk(pressed: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke('push_to_talk', { pressed });
}

/** Live mic level meter for onboarding/settings (no capture, no transcription). */
export async function micMonitor(enabled: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke('mic_monitor', { enabled });
}

/** Opens a project page in the system browser (the webview cannot follow target=_blank links itself). */
export async function openExternal(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  await invoke('open_external', { url });
}

export async function modelStatus(): Promise<ModelStatus[]> {
  if (!isTauri()) return [];
  return invoke<ModelStatus[]>('model_status');
}

export async function downloadModels(): Promise<void> {
  if (!isTauri()) return;
  await invoke('download_models');
}

export async function reloadShortcuts(pushToTalkKey: string, toggleSessionsKey: string): Promise<string[]> {
  if (!isTauri()) return [];
  return invoke<string[]>('set_shortcuts', { pushToTalk: pushToTalkKey, toggleSessions: toggleSessionsKey });
}

export async function onShellEvent<T>(event: string, cb: (payload: T) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<T>(event, (e) => cb(e.payload));
}

export async function windowAction(action: 'minimize' | 'maximize' | 'close'): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const w = getCurrentWindow();
  if (action === 'minimize') await w.minimize();
  else if (action === 'maximize') await w.toggleMaximize();
  else await w.hide();
}

export function detectPlatform(): Platform {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Mac/i.test(ua)) return 'mac';
  if (/Win/i.test(ua)) return 'win';
  return 'linux';
}
