/**
 * Deep links are inert (security-model R3): they can only navigate the UI. Any other host, and any
 * attempt to pass text/commands, resolves to `null` and is ignored.
 */
export type DeepLinkTarget =
  | { kind: 'show-home' }
  | { kind: 'show-sessions' }
  | { kind: 'open-settings'; tab?: SettingsTab }
  | { kind: 'pair'; code: string };

export const SETTINGS_TABS = [
  'general',
  'brain',
  'agents',
  'voice',
  'microphone',
  'privacy',
  'integrations',
  'shortcuts',
  'about',
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export function parseDeepLink(raw: string): DeepLinkTarget | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'jarvis:') return null;
  // jarvis://settings/voice  → host "settings", path "/voice"
  const host = url.hostname || url.pathname.replace(/^\/+/, '').split('/')[0] || '';
  const rest = (url.hostname ? url.pathname : url.pathname.replace(/^\/+[^/]*/, '')).replace(/^\/+/, '');
  switch (host) {
    case 'home':
      return { kind: 'show-home' };
    case 'sessions':
      return { kind: 'show-sessions' };
    case 'settings': {
      const tab = SETTINGS_TABS.find((t) => t === rest);
      return tab ? { kind: 'open-settings', tab } : { kind: 'open-settings' };
    }
    case 'pair': {
      // The pairing code is only *displayed* for confirmation; it never authorises anything by itself.
      const code = url.searchParams.get('code') ?? '';
      return /^[A-Z0-9]{6,12}$/.test(code) ? { kind: 'pair', code } : null;
    }
    default:
      return null;
  }
}
