/**
 * ElevenLabs TTS over HTTP streaming (`POST /v1/text-to-speech/{voice_id}/stream`, mp3).
 * `eleven_v3` understands audio tags, so neutral cues are rendered in its dialect; other models get clean text.
 */
import {
  dialectFor,
  ProviderError,
  renderCues,
  SECRET_KEYS,
  type TtsAudio,
  type TtsProvider,
  type TtsRequest,
  type TtsVoice,
} from '@jarvis/core';
import { fetchOf, type ProviderDeps, preferredVoice } from '../deps.js';
import { bodyChunks, fetchRetry, httpError, readErrorBody } from '../util/http.js';
import { clamp, DEFAULT_VOICES, lang } from './defaults.js';

const ID = 'elevenlabs';
export const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io';
/** Models that accept `language_code`. */
const LANGUAGE_CODE_MODELS = new Set(['eleven_v3', 'eleven_flash_v2_5', 'eleven_turbo_v2_5']);

export class ElevenLabsTts implements TtsProvider {
  readonly id = ID;
  readonly label = 'ElevenLabs';
  readonly supportsCues = true;

  constructor(
    private readonly deps: ProviderDeps,
    private readonly apiBase = ELEVENLABS_API_BASE,
  ) {}

  async configured(): Promise<boolean> {
    return !!(await this.deps.secrets.get(SECRET_KEYS.elevenlabsApiKey));
  }

  private async key(): Promise<string> {
    const key = await this.deps.secrets.get(SECRET_KEYS.elevenlabsApiKey);
    if (!key) throw new ProviderError('No ElevenLabs API key configured', 'not-configured', ID);
    return key;
  }

  async synthesize(req: TtsRequest): Promise<TtsAudio> {
    const key = await this.key();
    const s = this.deps.settings();
    const model = s.elevenlabsModel;
    const voice = req.voiceId ?? preferredVoice(s, ID, req.locale) ?? DEFAULT_VOICES.elevenlabs[lang(req.locale)];
    const body: Record<string, unknown> = {
      text: renderCues(req.text, dialectFor('elevenlabs', model)),
      model_id: model,
      voice_settings: { speed: clamp(req.speed ?? s.speakingRate, 0.7, 1.2) },
    };
    if (LANGUAGE_CODE_MODELS.has(model)) body.language_code = lang(req.locale);
    const url = `${this.apiBase}/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=mp3_44100_128`;
    const init: RequestInit = {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify(body),
    };
    if (req.signal) init.signal = req.signal;
    const res = await fetchRetry(fetchOf(this.deps), url, init, ID);
    if (!res.ok) {
      const err = await readErrorBody(res);
      throw httpError(ID, err, err.code === 'quota_exceeded' ? { 401: 'cap-reached', 429: 'cap-reached' } : undefined);
    }
    return { mime: 'audio/mpeg', chunks: bodyChunks(res) };
  }

  async voices(query?: string, locale?: string): Promise<TtsVoice[]> {
    const key = await this.key();
    const q = new URLSearchParams({ page_size: '100' });
    if (query) q.set('search', query);
    const res = await fetchRetry(
      fetchOf(this.deps),
      `${this.apiBase}/v2/voices?${q}`,
      { headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(15_000) },
      ID,
    );
    if (!res.ok) throw httpError(ID, await readErrorBody(res));
    const body = (await res.json()) as {
      voices?: Array<{
        voice_id: string;
        name: string;
        labels?: Record<string, string>;
        verified_languages?: Array<{ language?: string; locale?: string }>;
      }>;
    };
    const want = locale ? lang(locale) : undefined;
    return (
      (body.voices ?? [])
        .map((v): TtsVoice => {
          const langs = (v.verified_languages ?? [])
            .map((l) => l.language ?? l.locale?.slice(0, 2))
            .filter(Boolean) as string[];
          const voice: TtsVoice = { id: v.voice_id, name: v.name, tags: Object.values(v.labels ?? {}) };
          const match = want && langs.includes(want) ? want : langs[0];
          if (match) voice.locale = match;
          return voice;
        })
        // Multilingual models speak any language with any voice: rank verified matches first, keep the rest.
        .sort((a, b) => Number(b.locale === want) - Number(a.locale === want))
    );
  }
}
