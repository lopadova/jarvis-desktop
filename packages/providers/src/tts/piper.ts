/**
 * Piper — fully offline neural TTS. Runs the `piper` binary from `<dataDir>/models/piper/` and streams
 * raw PCM (s16le, mono, voice sample rate — 22050 Hz for the default voices) from stdout.
 *
 * `ensurePiper(voice)` downloads the platform binary (rhasspy/piper release 2023.11.14-2) and the voice
 * (rhasspy/piper-voices on Hugging Face) lazily, verifying every file against a pinned SHA-256.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ProviderError,
  stripCues,
  type TtsAudio,
  type TtsProvider,
  type TtsRequest,
  type TtsVoice,
} from '@jarvis/core';
import { fetchOf, type ProviderDeps, preferredVoice } from '../deps.js';
import { bodyChunks } from '../util/http.js';
import { DEFAULT_VOICES, lang } from './defaults.js';

const ID = 'piper';
const RELEASE = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2';
const VOICES_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';

interface Asset {
  url: string;
  sha256: string;
}

/** Pinned release archives (SHA-256 computed from the official release assets). */
export const PIPER_BINARIES: Record<string, Asset> = {
  'win32-x64': {
    url: `${RELEASE}/piper_windows_amd64.zip`,
    sha256: 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea',
  },
  'linux-x64': {
    url: `${RELEASE}/piper_linux_x86_64.tar.gz`,
    sha256: 'a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992',
  },
  'linux-arm64': {
    url: `${RELEASE}/piper_linux_aarch64.tar.gz`,
    sha256: 'fea0fd2d87c54dbc7078d0f878289f404bd4d6eea6e7444a77835d1537ab88eb',
  },
  'darwin-x64': {
    url: `${RELEASE}/piper_macos_x64.tar.gz`,
    sha256: 'ced85c0a3df13945b1e623b878a48fdc2854d5c485b4b67f62857cf551deaf8b',
  },
  'darwin-arm64': {
    url: `${RELEASE}/piper_macos_aarch64.tar.gz`,
    sha256: '6b1eb03b3735946cb35216e063e7eebcc33a6bbf5dd96ec0217959bf1cdcb0cc',
  },
};

export interface PiperVoiceAsset {
  name: string;
  locale: string;
  model: Asset;
  config: Asset;
}

/** Curated voices (SHA-256 from the Hugging Face LFS metadata / file contents). */
export const PIPER_VOICES: Record<string, PiperVoiceAsset> = {
  'it_IT-paola-medium': {
    name: 'Paola (Italian)',
    locale: 'it',
    model: {
      url: `${VOICES_BASE}/it/it_IT/paola/medium/it_IT-paola-medium.onnx`,
      sha256: '6fc918b5a0ea6137382833dddfa567bffbe6a5060c02043c87192ee59c04210c',
    },
    config: {
      url: `${VOICES_BASE}/it/it_IT/paola/medium/it_IT-paola-medium.onnx.json`,
      sha256: 'aea19c0a7fce29fbc359b93f10e7902854401e4c95ae2ea328ae516b15d296cf',
    },
  },
  'en_US-lessac-medium': {
    name: 'Lessac (US English)',
    locale: 'en',
    model: {
      url: `${VOICES_BASE}/en/en_US/lessac/medium/en_US-lessac-medium.onnx`,
      sha256: '5efe09e69902187827af646e1a6e9d269dee769f9877d17b16b1b46eeaaf019f',
    },
    config: {
      url: `${VOICES_BASE}/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json`,
      sha256: 'efe19c417bed055f2d69908248c6ba650fa135bc868b0e6abb3da181dab690a0',
    },
  },
};

export interface PiperPaths {
  root: string;
  binary: string;
  voicesDir: string;
}

export function piperPaths(dataDir: string, platform: NodeJS.Platform = process.platform): PiperPaths {
  const root = join(dataDir, 'models', 'piper');
  return {
    root,
    binary: join(root, 'piper', platform === 'win32' ? 'piper.exe' : 'piper'),
    voicesDir: join(root, 'voices'),
  };
}

const voiceFiles = (paths: PiperPaths, voice: string) => ({
  model: join(paths.voicesDir, `${voice}.onnx`),
  config: join(paths.voicesDir, `${voice}.onnx.json`),
});

/** Downloads to `<dest>.part`, verifies SHA-256, then atomically renames. */
export async function downloadVerified(
  fetchImpl: typeof fetch,
  asset: Asset,
  dest: string,
  signal?: AbortSignal,
): Promise<void> {
  const part = `${dest}.part`;
  const init: RequestInit = signal ? { signal } : {};
  const res = await fetchImpl(asset.url, init);
  if (!res.ok) throw new ProviderError(`Download failed (HTTP ${res.status}): ${asset.url}`, 'network', ID);
  const hash = createHash('sha256');
  const fh = await open(part, 'w');
  try {
    for await (const chunk of bodyChunks(res)) {
      hash.update(chunk);
      await fh.write(chunk);
    }
  } finally {
    await fh.close();
  }
  const digest = hash.digest('hex');
  if (digest !== asset.sha256) {
    await rm(part, { force: true });
    throw new ProviderError(`Checksum mismatch for ${asset.url}`, 'bad-response', ID);
  }
  await rename(part, dest);
}

function extract(archive: string, dir: string): Promise<void> {
  // bsdtar (Windows 10+, macOS) and GNU tar (Linux) both handle these archives; Windows' tar.exe handles .zip.
  const tar =
    process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  return new Promise((resolve, reject) => {
    const p = spawn(tar, ['-xf', archive, '-C', dir], { stdio: 'ignore', windowsHide: true });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited with ${code}`))));
  });
}

/**
 * Installs the Piper binary for this platform and the requested voice if missing (lazy — call only
 * when the user picks Piper). Safe to call repeatedly.
 */
export async function ensurePiper(
  deps: Pick<ProviderDeps, 'dataDir' | 'fetch' | 'logger'>,
  voice: string,
  signal?: AbortSignal,
): Promise<PiperPaths> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const paths = piperPaths(deps.dataDir);
  await mkdir(paths.voicesDir, { recursive: true });
  if (!existsSync(paths.binary)) {
    const asset = PIPER_BINARIES[`${process.platform}-${process.arch}`];
    if (!asset)
      throw new ProviderError(`Piper has no build for ${process.platform}-${process.arch}`, 'not-configured', ID);
    const archive = join(paths.root, asset.url.endsWith('.zip') ? 'piper.zip' : 'piper.tar.gz');
    deps.logger.info('piper: downloading engine', { url: asset.url });
    await downloadVerified(fetchImpl, asset, archive, signal);
    try {
      await extract(archive, paths.root);
    } finally {
      await rm(archive, { force: true });
    }
    if (process.platform !== 'win32') await chmod(paths.binary, 0o755);
  }
  const v = PIPER_VOICES[voice];
  const files = voiceFiles(paths, voice);
  if (!existsSync(files.model) || !existsSync(files.config)) {
    if (!v) throw new ProviderError(`Unknown Piper voice "${voice}"`, 'not-configured', ID);
    deps.logger.info('piper: downloading voice', { voice });
    await downloadVerified(fetchImpl, v.config, files.config, signal);
    await downloadVerified(fetchImpl, v.model, files.model, signal);
  }
  return paths;
}

export class PiperTts implements TtsProvider {
  readonly id = ID;
  readonly label = 'Piper (offline)';
  readonly supportsCues = false;
  private readonly paths: PiperPaths;

  constructor(private readonly deps: ProviderDeps) {
    this.paths = piperPaths(deps.dataDir);
  }

  private voiceFor(locale: string, voiceId?: string): string {
    return voiceId ?? preferredVoice(this.deps.settings(), ID, locale) ?? DEFAULT_VOICES.piper[lang(locale)];
  }

  async configured(): Promise<boolean> {
    const files = voiceFiles(this.paths, this.voiceFor(this.deps.settings().locale));
    return existsSync(this.paths.binary) && existsSync(files.model) && existsSync(files.config);
  }

  /** Downloads engine + voice for a locale (UI calls this when the user selects Piper). */
  install(locale: string, signal?: AbortSignal): Promise<PiperPaths> {
    return ensurePiper(this.deps, this.voiceFor(locale), signal);
  }

  async synthesize(req: TtsRequest): Promise<TtsAudio> {
    const voice = this.voiceFor(req.locale, req.voiceId);
    const files = voiceFiles(this.paths, voice);
    if (!existsSync(this.paths.binary) || !existsSync(files.model)) {
      throw new ProviderError(`Piper voice "${voice}" is not installed`, 'not-configured', ID);
    }
    let rate = 22050;
    try {
      const cfg = JSON.parse(await readFile(files.config, 'utf8')) as { audio?: { sample_rate?: number } };
      rate = cfg.audio?.sample_rate ?? rate;
    } catch {
      // keep default
    }
    const speed = req.speed ?? this.deps.settings().speakingRate;
    const args = [
      '--model',
      files.model,
      '--config',
      files.config,
      '--output_raw',
      '--quiet',
      '--length_scale',
      (1 / Math.max(0.5, Math.min(2, speed))).toFixed(3),
    ];
    const child = spawn(this.paths.binary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      cwd: this.paths.root,
    });
    const onAbort = () => child.kill();
    req.signal?.addEventListener('abort', onAbort, { once: true });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < 4000) stderr += d.toString();
    });
    child.stdin.on('error', () => {});
    // One line = one utterance for piper; flatten the text.
    child.stdin.end(`${stripCues(req.text).replace(/\s*\n+\s*/g, ' ')}\n`);
    const exited = new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    exited.catch(() => {}); // surfaced when the consumer reads the chunks
    async function* chunks(): AsyncIterable<Uint8Array> {
      try {
        for await (const chunk of child.stdout) yield new Uint8Array(chunk as Buffer);
        const code = await exited;
        if (req.signal?.aborted) return;
        if (code !== 0)
          throw new ProviderError(`Piper exited with ${code}: ${stderr.trim().slice(-300)}`, 'bad-response', ID);
      } finally {
        req.signal?.removeEventListener('abort', onAbort);
        if (child.exitCode === null) child.kill();
      }
    }
    return { mime: `audio/pcm;rate=${rate}`, chunks: chunks() };
  }

  async voices(_query?: string, locale?: string): Promise<TtsVoice[]> {
    return Object.entries(PIPER_VOICES)
      .filter(([, v]) => !locale || v.locale === lang(locale))
      .map(([id, v]) => ({ id, name: v.name, locale: v.locale }));
  }
}
