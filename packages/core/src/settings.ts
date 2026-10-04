import { z } from 'zod';

const hotkey = z.string().min(1).max(64);

/** User settings. Unknown keys are dropped; missing keys take defaults (forward/backward compatible). */
export const SettingsSchema = z.object({
  locale: z.enum(['en', 'it']).default('en'),
  userName: z.string().max(80).default(''),
  onboardingComplete: z.boolean().default(false),
  launchAtLogin: z.boolean().default(false),
  theme: z.enum(['system', 'dark', 'light']).default('system'),
  material: z.enum(['auto', 'glass', 'solid']).default('auto'),
  accentHue: z.number().min(0).max(360).default(200),

  primaryBrain: z.enum(['chatgpt', 'claude', 'codex', 'api-anthropic', 'api-openai', 'local']).nullable().default(null),
  localBrain: z
    .object({ baseUrl: z.string().default('http://127.0.0.1:11434/v1'), model: z.string().default('llama3.2') })
    .default({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.2' }),
  apiModels: z
    .object({ anthropic: z.string().default('claude-haiku-4-5'), openai: z.string().default('gpt-5-mini') })
    .default({ anthropic: 'claude-haiku-4-5', openai: 'gpt-5-mini' }),
  chatgptModel: z.string().default(''),
  codingModel: z.string().default('claude-opus-5-5'),
  defaultAgent: z.enum(['claude', 'codex', 'home']).default('claude'),
  maxConcurrentSessions: z.number().int().min(1).max(12).default(4),
  generalWorkspace: z.string().default(''),
  projectsRoot: z.string().default('~/Projects'),
  claudePath: z.string().default(''),
  codexPath: z.string().default(''),

  tts: z.enum(['elevenlabs', 'fish', 'openai', 'kokoro', 'piper', 'system']).default('system'),
  ttsVoice: z.record(z.string(), z.string()).default({}),
  elevenlabsModel: z.enum(['eleven_v3', 'eleven_flash_v2_5', 'eleven_multilingual_v2']).default('eleven_v3'),
  fishModel: z.string().default('s2-pro'),
  /** ElevenLabs voice settings (all models accept them; Eleven v3 mostly follows `stability`). */
  elevenlabsVoice: z
    .object({
      stability: z.number().min(0).max(1).default(0.5),
      similarityBoost: z.number().min(0).max(1).default(0.75),
      style: z.number().min(0).max(1).default(0),
      speakerBoost: z.boolean().default(true),
    })
    .default({ stability: 0.5, similarityBoost: 0.75, style: 0, speakerBoost: true }),
  speakingRate: z.number().min(0.5).max(2).default(1),
  speakReplies: z.boolean().default(true),
  speakProgress: z.boolean().default(true),
  speakSummaries: z.boolean().default(true),
  muteDuringFocus: z.boolean().default(true),

  stt: z.enum(['local-whisper', 'openai', 'elevenlabs']).default('local-whisper'),
  whisperModel: z.enum(['tiny', 'base', 'small', 'medium', 'large-v3-turbo']).default('small'),
  wakeWord: z.boolean().default(true),
  wakeOnClap: z.boolean().default(false),
  conversationMode: z.boolean().default(true),
  conversationWindowMs: z.number().int().min(2000).max(20000).default(6000),
  echoCancellation: z.boolean().default(true),
  pushToTalk: hotkey.default('Alt+Space'),
  toggleSessions: hotkey.default('CommandOrControl+Shift+J'),

  privateMode: z.boolean().default(false),
  /** Opt-in: "what's on my screen?" may capture one screenshot per request and send it to a vision brain. */
  screenAccess: z.boolean().default(false),
  openResults: z.boolean().default(true),
  historyRetentionDays: z.number().int().min(0).max(3650).default(30),
  relayUrl: z.string().default(''),
  relayExposeWriteTools: z.boolean().default(false),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const defaultSettings = (): Settings => SettingsSchema.parse({});

export function mergeSettings(current: Settings, patch: Record<string, unknown>): Settings {
  return SettingsSchema.parse({ ...current, ...patch });
}
