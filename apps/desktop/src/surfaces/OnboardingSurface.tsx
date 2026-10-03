/** Onboarding container (lazy chunk): store + IPC → presentational `Onboarding`. */
import { useCallback } from 'react';
import { Onboarding } from '../components/onboarding/Onboarding';
import { micMonitor, showWindow, windowAction } from '../lib/tauri';
import { send, useApp } from '../store/app';
import type { Platform } from '../types/ui';

export function OnboardingSurface({ platform }: { platform: Platform }) {
  const s = useApp();
  const monitor = useCallback((on: boolean) => void micMonitor(on), []);
  return (
    <Onboarding
      platform={platform}
      locale={s.settings.locale}
      providers={s.providers}
      primary={s.settings.primaryBrain}
      micLevel={s.micLevel}
      tts={s.settings.tts}
      pill={s.pill.state}
      privateMode={s.pill.privateMode}
      onMicMonitor={monitor}
      onSignInChatGpt={() => send('providers.signIn', { provider: 'chatgpt' })}
      onSecret={(key, value) => send('secrets.set', { key, value })}
      onUseLocal={() => send('providers.setPrimary', { brain: 'local' })}
      onUseClaude={() => send('providers.setPrimary', { brain: 'claude' })}
      onSetPrimary={(brain) => send('providers.setPrimary', { brain })}
      onTts={(tts) => send('settings.update', { patch: { tts } })}
      onPreview={(provider) => send('tts.preview', { provider })}
      onLocale={(locale) => send('settings.update', { patch: { locale } })}
      onTry={(text) => send('turn.submit', { text, source: 'voice' })}
      onClose={() => void windowAction('close')}
      onFinish={() => {
        send('settings.update', { patch: { onboardingComplete: true } });
        void showWindow('home');
        void windowAction('close');
      }}
    />
  );
}

export default OnboardingSurface;
