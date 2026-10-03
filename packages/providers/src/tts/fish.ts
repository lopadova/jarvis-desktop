/**
 * Fish Audio TTS (`POST https://api.fish.audio/v1/tts`, JSON body, chunked mp3 response).
 * The `model` header carries settings.fishModel; neutral cues are rendered in Fish's dialect.
 */
import {
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
import { clamp, lang } from './defaults.js';

const ID = 'fish';
export const FISH_API_BASE = 'https://api.fish.audio';

export class FishTts implements TtsProvider {
  readonly id = ID;
  readonly label = 'Fish Audio';
  readonly supportsCues = true;

  constructor(
    private readonly deps: ProviderDeps,
    private readonly apiBase = FISH_API_BASE,
  ) {}

  async configured(): Promise<boolean> {
    return !!(await this.deps.secrets.get(SECRET_KEYS.fishApiKey));
  }

  private async key(): Promise<string> {
    const key = await this.deps.secrets.get(SECRET_KEYS.fishApiKey);
    if (!key) throw new ProviderError('No Fish Audio API key configured', 'not-configured', ID);
    return key;
  }

  async synthesize(req: TtsRequest): Promise<TtsAudio> {
    const key = await this.key();
    const s = this.deps.settings();
    const voice = req.voiceId ?? preferredVoice(s, ID, req.locale);
    const body: Record<string, unknown> = {
      text: renderCues(req.text, 'fish'),
      format: 'mp3',
      mp3_bitrate: 128,
      latency: 'balanced',
      normalize: true,
      prosody: { speed: clamp(req.speed ?? s.speakingRate, 0.5, 2) },
    };
    if (voice) body.reference_id = voice;
    const init: RequestInit = {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', model: s.fishModel },
      body: JSON.stringify(body),
    };
    if (req.signal) init.signal = req.signal;
    const res = await fetchRetry(fetchOf(this.deps), `${this.apiBase}/v1/tts`, init, ID);
    if (!res.ok) throw httpError(ID, await readErrorBody(res), { 402: 'cap-reached' });
    return { mime: 'audio/mpeg', chunks: bodyChunks(res) };
  }

  async voices(query?: string, locale?: string): Promise<TtsVoice[]> {
    const key = await this.key();
    const q = new URLSearchParams({ page_size: '30', sort_by: 'score' });
    if (query) q.set('title', query);
    if (locale) q.set('language', lang(locale));
    const res = await fetchRetry(
      fetchOf(this.deps),
      `${this.apiBase}/model?${q}`,
      { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) },
      ID,
    );
    if (!res.ok) throw httpError(ID, await readErrorBody(res));
    const body = (await res.json()) as {
      items?: Array<{ _id: string; title: string; languages?: string[]; tags?: string[] }>;
    };
    return (body.items ?? []).map((m) => {
      const v: TtsVoice = { id: m._id, name: m.title, tags: m.tags ?? [] };
      if (m.languages?.[0]) v.locale = m.languages[0];
      return v;
    });
  }
}
