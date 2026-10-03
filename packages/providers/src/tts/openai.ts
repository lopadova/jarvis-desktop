/**
 * OpenAI TTS (`POST /v1/audio/speech`, gpt-4o-mini-tts, streamed mp3). Requires an API key —
 * ChatGPT plan tokens do not cover audio. Cues are stripped.
 */
import {
  ProviderError,
  SECRET_KEYS,
  stripCues,
  type TtsAudio,
  type TtsProvider,
  type TtsRequest,
  type TtsVoice,
} from '@jarvis/core';
import { fetchOf, type ProviderDeps, preferredVoice } from '../deps.js';
import { bodyChunks, fetchRetry, httpError, readErrorBody } from '../util/http.js';
import { clamp, DEFAULT_VOICES, lang } from './defaults.js';

const ID = 'openai';
export const OPENAI_TTS_MODEL = 'gpt-4o-mini-tts';
export const OPENAI_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'cedar',
  'coral',
  'echo',
  'fable',
  'marin',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
];

export class OpenAiTts implements TtsProvider {
  readonly id = ID;
  readonly label = 'OpenAI';
  readonly supportsCues = false;

  constructor(
    private readonly deps: ProviderDeps,
    private readonly apiBase = 'https://api.openai.com/v1',
  ) {}

  async configured(): Promise<boolean> {
    return !!(await this.deps.secrets.get(SECRET_KEYS.openaiApiKey));
  }

  async synthesize(req: TtsRequest): Promise<TtsAudio> {
    const key = await this.deps.secrets.get(SECRET_KEYS.openaiApiKey);
    if (!key)
      throw new ProviderError('OpenAI voice needs an API key (ChatGPT plans do not cover audio)', 'not-configured', ID);
    const s = this.deps.settings();
    const init: RequestInit = {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_TTS_MODEL,
        input: stripCues(req.text),
        voice: req.voiceId ?? preferredVoice(s, ID, req.locale) ?? DEFAULT_VOICES.openai[lang(req.locale)],
        response_format: 'mp3',
        speed: clamp(req.speed ?? s.speakingRate, 0.25, 4),
      }),
    };
    if (req.signal) init.signal = req.signal;
    const res = await fetchRetry(fetchOf(this.deps), `${this.apiBase}/audio/speech`, init, ID);
    if (!res.ok) {
      const err = await readErrorBody(res);
      throw httpError(ID, err, err.code === 'insufficient_quota' ? { 429: 'cap-reached' } : undefined);
    }
    return { mime: 'audio/mpeg', chunks: bodyChunks(res) };
  }

  async voices(query?: string): Promise<TtsVoice[]> {
    const q = query?.toLowerCase();
    return OPENAI_VOICES.filter((v) => !q || v.includes(q)).map((v) => ({
      id: v,
      name: v[0]?.toUpperCase() + v.slice(1),
    }));
  }
}
