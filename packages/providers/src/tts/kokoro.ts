/**
 * Kokoro — local neural TTS via the optional `kokoro-js` package (not a hard dependency: it pulls in
 * transformers.js + onnxruntime). Install it next to the sidecar to enable this provider; otherwise
 * `configured()` is false. The model (~90 MB, q8) is fetched by transformers.js on first use.
 */
import {
  ProviderError,
  stripCues,
  type TtsAudio,
  type TtsProvider,
  type TtsRequest,
  type TtsVoice,
} from '@jarvis/core';
import { type ProviderDeps, preferredVoice } from '../deps.js';
import { DEFAULT_VOICES, lang } from './defaults.js';

const ID = 'kokoro';
export const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

interface KokoroAudio {
  audio: Float32Array;
  sampling_rate: number;
}
interface KokoroInstance {
  generate(text: string, opts: { voice: string; speed?: number }): Promise<KokoroAudio>;
  list_voices?(): unknown;
}
interface KokoroModule {
  KokoroTTS: { from_pretrained(model: string, opts: { dtype: string; device?: string }): Promise<KokoroInstance> };
}

export type KokoroLoader = () => Promise<KokoroModule | null>;

/** Default loader: dynamic import with a non-literal specifier so bundlers/TS don't require the package. */
export const loadKokoroModule: KokoroLoader = async () => {
  const spec = 'kokoro-js';
  try {
    return (await import(spec)) as KokoroModule;
  } catch {
    return null;
  }
};

/** Float32 [-1, 1] → PCM16 little-endian. */
export function floatToPcm16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

export class KokoroTts implements TtsProvider {
  readonly id = ID;
  readonly label = 'Kokoro (local)';
  readonly supportsCues = false;
  private instance: Promise<KokoroInstance> | undefined;

  constructor(
    private readonly deps: ProviderDeps,
    private readonly loader: KokoroLoader = loadKokoroModule,
  ) {}

  async configured(): Promise<boolean> {
    return (await this.loader()) !== null;
  }

  private load(): Promise<KokoroInstance> {
    if (!this.instance) {
      this.instance = (async () => {
        const mod = await this.loader();
        if (!mod) throw new ProviderError('kokoro-js is not installed', 'not-configured', ID);
        return mod.KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: 'q8', device: 'cpu' });
      })();
      this.instance.catch(() => {
        this.instance = undefined;
      });
    }
    return this.instance;
  }

  async synthesize(req: TtsRequest): Promise<TtsAudio> {
    const tts = await this.load();
    const voice =
      req.voiceId ?? preferredVoice(this.deps.settings(), ID, req.locale) ?? DEFAULT_VOICES.kokoro[lang(req.locale)];
    const speed = req.speed ?? this.deps.settings().speakingRate;
    const signal = req.signal;
    const audio = await tts.generate(stripCues(req.text), { voice, speed });
    if (signal?.aborted) throw new ProviderError('Request cancelled', 'aborted', ID);
    const pcm = floatToPcm16(audio.audio);
    async function* chunks(): AsyncIterable<Uint8Array> {
      const step = 16_384;
      for (let i = 0; i < pcm.length; i += step) {
        if (signal?.aborted) return;
        yield pcm.subarray(i, i + step);
      }
    }
    return { mime: `audio/pcm;rate=${audio.sampling_rate}`, chunks: chunks() };
  }

  async voices(): Promise<TtsVoice[]> {
    return [
      { id: 'bm_george', name: 'George', locale: 'en', tags: ['british', 'male'] },
      { id: 'bm_lewis', name: 'Lewis', locale: 'en', tags: ['british', 'male'] },
      { id: 'bf_emma', name: 'Emma', locale: 'en', tags: ['british', 'female'] },
      { id: 'am_michael', name: 'Michael', locale: 'en', tags: ['american', 'male'] },
      { id: 'af_heart', name: 'Heart', locale: 'en', tags: ['american', 'female'] },
    ];
  }
}
