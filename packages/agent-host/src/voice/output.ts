/**
 * Voice output: text → speakable sentences → selected TTS provider (cues rendered per dialect) →
 * binary audio frames to the shell (`host.audio.begin` / frames / `host.audio.end`).
 * Falls back to the OS voice (`host.systemSpeak`, cues stripped) when the provider is missing,
 * unconfigured, blocked by private mode, or fails before producing audio.
 * Supports stop/barge-in, pause, DND muting and the pill "speaking" state.
 */
import {
  dialectFor,
  type HostMethods,
  type Logger,
  renderCues,
  SentenceChunker,
  type Settings,
  speakable,
  stripCues,
  type TtsId,
} from '@jarvis/core';
import type { HostClient } from '../host.js';
import type { Pill } from '../pill.js';
import { LOCAL_TTS, type TtsRegistry } from '../providers-contract.js';
import { errorMessage, newUtteranceId } from '../util.js';

export type ListeningMode = HostMethods['host.setListening']['params']['mode'];

export interface VoiceOutputDeps {
  host: HostClient;
  tts: TtsRegistry;
  settings: () => Settings;
  logger: Logger;
  pill: Pill;
  /** Notified when a provider is skipped (e.g. private mode) so the UI can show why. */
  onNotice?: (message: string) => void;
  /** The selected provider could not be used and the system voice was used instead. */
  onFallback?: (provider: TtsId, label: string, why: 'not-configured' | 'failed') => void;
}

/** Per-utterance provider override (voice previews in settings). */
export interface VoiceOverride {
  tts: TtsId;
  voiceId?: string;
}

interface Item {
  text: string;
  done: () => void;
  voice?: VoiceOverride;
}

export interface SpeechStream {
  push(delta: string): void;
  end(): Promise<void>;
}

export class VoiceOutput {
  private readonly queue: Item[] = [];
  private running = false;
  private generation = 0;
  private abort: AbortController | null = null;
  private readonly ended = new Set<string>();
  private readonly waiters = new Map<string, () => void>();
  private currentText = '';
  private spokenCount = 0;
  private totalCount = 0;
  private dnd = false;
  private paused = false;
  lastSpoken = '';

  constructor(private readonly deps: VoiceOutputDeps) {}

  get busy(): boolean {
    return this.running || this.queue.length > 0;
  }

  get muted(): boolean {
    return this.dnd && this.deps.settings().muteDuringFocus;
  }

  setDoNotDisturb(on: boolean): void {
    this.dnd = on;
    if (this.muted) {
      this.stop();
      this.deps.pill.set({ kind: 'muted', reason: 'focus' });
    } else if (!on) this.deps.pill.set({ kind: 'hidden' });
  }

  /** Queues text (split into sentences) and resolves when it has been spoken (or dropped). */
  speak(text: string, voice?: VoiceOverride): Promise<void> {
    const clean = speakable(text);
    if (!clean) return Promise.resolve();
    const chunker = new SentenceChunker();
    const parts = chunker.push(`${clean} `);
    const tail = chunker.flush();
    if (tail) parts.push(tail);
    this.lastSpoken = clean;
    return Promise.all(parts.map((p) => this.enqueue(p, voice))).then(() => undefined);
  }

  /** Streaming variant for brain deltas: each completed sentence is synthesised as soon as it is ready. */
  stream(): SpeechStream {
    const chunker = new SentenceChunker();
    const promises: Promise<void>[] = [];
    let all = '';
    return {
      push: (delta: string) => {
        all += delta;
        for (const s of chunker.push(delta)) {
          const sp = speakable(s);
          if (sp) promises.push(this.enqueue(sp));
        }
      },
      end: async () => {
        const tail = chunker.flush();
        if (tail) {
          const sp = speakable(tail);
          if (sp) promises.push(this.enqueue(sp));
        }
        this.lastSpoken = speakable(all);
        await Promise.all(promises);
      },
    };
  }

  /** Stops speech immediately (Esc, "stop", barge-in) and drops everything queued. */
  stop(): void {
    this.generation++;
    this.abort?.abort();
    for (const it of this.queue.splice(0)) it.done();
    for (const w of this.waiters.values()) w();
    this.waiters.clear();
    if (this.deps.host.connected) void this.deps.host.call('host.audio.stop', {}).catch(() => undefined);
  }

  pause(paused: boolean): void {
    this.paused = paused;
    if (this.deps.host.connected) void this.deps.host.call('host.audio.pause', { paused }).catch(() => undefined);
  }

  onPlaybackLevel(level: number): void {
    if (!this.running) return;
    const progress = this.totalCount ? Math.min(1, this.spokenCount / this.totalCount) : 0;
    this.deps.pill.set({ kind: 'speaking', text: this.currentText, progress, level });
  }

  onPlaybackEnded(utteranceId: string): void {
    const w = this.waiters.get(utteranceId);
    if (w) {
      this.waiters.delete(utteranceId);
      w();
    } else {
      this.ended.add(utteranceId);
      if (this.ended.size > 64) this.ended.delete(this.ended.values().next().value as string);
    }
  }

  setListening(mode: ListeningMode, conversationMs?: number): void {
    if (!this.deps.host.connected) return;
    const s = this.deps.settings();
    const params: HostMethods['host.setListening']['params'] =
      mode === 'conversation' ? { mode, conversationMs: conversationMs ?? s.conversationWindowMs } : { mode };
    void this.deps.host.call('host.setListening', params).catch(() => undefined);
  }

  private enqueue(text: string, voice?: VoiceOverride): Promise<void> {
    if (this.muted) return Promise.resolve();
    return new Promise<void>((done) => {
      this.queue.push(voice ? { text, done, voice } : { text, done });
      this.totalCount++;
      if (!this.running) void this.drain();
    });
  }

  private async drain(): Promise<void> {
    this.running = true;
    const gen = this.generation;
    this.setListening('speaking');
    try {
      while (this.queue.length && gen === this.generation) {
        const it = this.queue.shift() as Item;
        this.currentText = it.text;
        this.deps.pill.set({
          kind: 'speaking',
          text: it.text,
          progress: this.totalCount ? this.spokenCount / this.totalCount : 0,
          level: 0,
        });
        try {
          await this.speakOne(it.text, gen, it.voice);
        } catch (e) {
          this.deps.logger.warn('speech failed', { error: errorMessage(e) });
        }
        this.spokenCount++;
        it.done();
      }
    } finally {
      this.running = false;
      this.spokenCount = 0;
      this.totalCount = 0;
      if (this.queue.length) void this.drain();
      else {
        this.deps.pill.set({ kind: 'hidden' });
        if (gen === this.generation) this.setListening(this.deps.settings().conversationMode ? 'conversation' : 'idle');
        else this.setListening('idle');
      }
    }
  }

  private spokenLog: { at: number; text: string }[] = [];

  /** What Jarvis said in the last `windowMs` (used to drop its own voice picked up by the microphone). */
  recentSpoken(windowMs: number): string[] {
    const since = Date.now() - windowMs;
    return this.spokenLog.filter((x) => x.at >= since).map((x) => x.text);
  }

  private async speakOne(text: string, gen: number, voice?: VoiceOverride): Promise<void> {
    this.spokenLog.push({ at: Date.now(), text: stripCues(text) });
    if (this.spokenLog.length > 20) this.spokenLog.shift();
    const s = this.deps.settings();
    const id = voice?.tts ?? s.tts;
    const provider = id === 'system' ? undefined : this.deps.tts.get(id);
    if (provider && s.privateMode && !LOCAL_TTS.includes(id)) {
      this.deps.onNotice?.(`private-mode: ${provider.label} skipped`);
      return this.systemSpeak(text, gen);
    }
    if (!provider) return this.systemSpeak(text, gen);
    let configured = false;
    try {
      configured = await provider.configured();
    } catch {
      configured = false;
    }
    if (!configured) {
      this.deps.onFallback?.(id, provider.label, 'not-configured');
      return this.systemSpeak(text, gen);
    }

    const utteranceId = newUtteranceId();
    const abort = new AbortController();
    this.abort = abort;
    let begun = false;
    try {
      const audio = await provider.synthesize({
        text: renderCues(text, provider.supportsCues ? dialectFor(id, s.elevenlabsModel) : 'none'),
        locale: s.locale,
        voiceId: voice?.voiceId ?? s.ttsVoice[id],
        speed: s.speakingRate,
        signal: abort.signal,
      });
      for await (const chunk of audio.chunks) {
        if (gen !== this.generation) break;
        if (!begun) {
          await this.deps.host.call('host.audio.begin', { utteranceId, mime: audio.mime });
          begun = true;
        }
        this.deps.host.sendAudio(utteranceId, chunk);
      }
    } catch (e) {
      if (gen !== this.generation) return;
      this.deps.logger.warn('tts provider failed, falling back to system voice', {
        provider: id,
        error: errorMessage(e),
      });
      if (!begun) {
        this.deps.onFallback?.(id, provider.label, 'failed');
        return this.systemSpeak(text, gen);
      }
    } finally {
      if (this.abort === abort) this.abort = null;
    }
    if (!begun) return;
    await this.deps.host.call('host.audio.end', { utteranceId }).catch(() => undefined);
    if (gen === this.generation) await this.waitPlayback(utteranceId, text);
  }

  private async systemSpeak(text: string, gen: number): Promise<void> {
    if (gen !== this.generation) return;
    const s = this.deps.settings();
    const utteranceId = newUtteranceId();
    await this.deps.host.call('host.systemSpeak', {
      text: stripCues(text),
      locale: s.locale,
      rate: s.speakingRate,
      utteranceId,
    });
    if (gen === this.generation) await this.waitPlayback(utteranceId, text);
  }

  private waitPlayback(utteranceId: string, text: string): Promise<void> {
    if (this.ended.delete(utteranceId)) return Promise.resolve();
    const ms = Math.min(60_000, Math.max(3_000, text.length * 90 + 2_000)) + (this.paused ? 60_000 : 0);
    return new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        this.waiters.delete(utteranceId);
        resolve();
      }, ms);
      t.unref?.();
      this.waiters.set(utteranceId, () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}
