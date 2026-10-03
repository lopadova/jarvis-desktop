/**
 * Cloud speech-to-text (used only when the user enables it — security-model R11). Local Whisper
 * runs in the Rust shell and is not part of this package.
 */
import { ProviderError, SECRET_KEYS, type SttId, type SttProvider, type SttRequest } from '@jarvis/core';
import { fetchOf, type ProviderDeps } from '../deps.js';
import { fetchRetry, httpError, operation, readErrorBody } from '../util/http.js';
import { pcm16ToWav } from './wav.js';

const TIMEOUT_MS = 30_000;
const iso639 = (locale: string): string => locale.slice(0, 2).toLowerCase();

async function transcribeMultipart(
  deps: ProviderDeps,
  provider: SttId,
  url: string,
  headers: Record<string, string>,
  fields: Record<string, string>,
  req: SttRequest,
): Promise<{ text: string }> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set('file', new Blob([pcm16ToWav(req.pcm) as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }), 'speech.wav');
  const op = operation(provider, TIMEOUT_MS, req.signal);
  try {
    const res = await fetchRetry(
      fetchOf(deps),
      url,
      { method: 'POST', headers, body: form, signal: op.signal },
      provider,
    );
    if (!res.ok) throw httpError(provider, await readErrorBody(res));
    const body = (await res.json()) as { text?: string };
    op.done();
    if (typeof body.text !== 'string')
      throw new ProviderError('Transcription response has no text', 'bad-response', provider);
    return { text: body.text.trim() };
  } catch (e) {
    throw op.fail(e);
  }
}

export class OpenAiStt implements SttProvider {
  readonly id = 'openai' as const;
  readonly label = 'OpenAI (gpt-4o-transcribe)';

  constructor(
    private readonly deps: ProviderDeps,
    private readonly apiBase = 'https://api.openai.com/v1',
  ) {}

  async configured(): Promise<boolean> {
    return !!(await this.deps.secrets.get(SECRET_KEYS.openaiApiKey));
  }

  async transcribe(req: SttRequest): Promise<{ text: string }> {
    const key = await this.deps.secrets.get(SECRET_KEYS.openaiApiKey);
    if (!key) throw new ProviderError('No OpenAI API key configured', 'not-configured', this.id);
    return transcribeMultipart(
      this.deps,
      this.id,
      `${this.apiBase}/audio/transcriptions`,
      { authorization: `Bearer ${key}` },
      { model: 'gpt-4o-transcribe', language: iso639(req.locale), response_format: 'json' },
      req,
    );
  }
}

export class ElevenLabsStt implements SttProvider {
  readonly id = 'elevenlabs' as const;
  readonly label = 'ElevenLabs Scribe';

  constructor(
    private readonly deps: ProviderDeps,
    private readonly apiBase = 'https://api.elevenlabs.io',
  ) {}

  async configured(): Promise<boolean> {
    return !!(await this.deps.secrets.get(SECRET_KEYS.elevenlabsApiKey));
  }

  async transcribe(req: SttRequest): Promise<{ text: string }> {
    const key = await this.deps.secrets.get(SECRET_KEYS.elevenlabsApiKey);
    if (!key) throw new ProviderError('No ElevenLabs API key configured', 'not-configured', this.id);
    return transcribeMultipart(
      this.deps,
      this.id,
      `${this.apiBase}/v1/speech-to-text`,
      { 'xi-api-key': key },
      { model_id: 'scribe_v2', language_code: iso639(req.locale), tag_audio_events: 'false' },
      req,
    );
  }
}

export interface SttRegistry {
  get(id: SttId): SttProvider | undefined;
  list(): SttProvider[];
}

/** Cloud STT only — `local-whisper` runs in the Rust shell. */
export function createSttRegistry(deps: ProviderDeps): SttRegistry {
  const providers: SttProvider[] = [new OpenAiStt(deps), new ElevenLabsStt(deps)];
  const byId = new Map(providers.map((p) => [p.id, p]));
  return { get: (id) => byId.get(id), list: () => [...providers] };
}
