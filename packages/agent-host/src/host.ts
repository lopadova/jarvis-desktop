/** Interfaces between the application core and the transport (RPC server or test fakes). */
import type { HostMethod, HostMethods, Role, UiEvent } from '@jarvis/core';

/** Requests served by the Rust shell (`host.*`). */
export interface HostClient {
  readonly connected: boolean;
  call<M extends HostMethod>(
    method: M,
    params: HostMethods[M]['params'],
    timeoutMs?: number,
  ): Promise<HostMethods[M]['result']>;
  /** Sends one binary audio frame: [16-byte ascii utteranceId][payload]. */
  sendAudio(utteranceId: string, chunk: Uint8Array): void;
}

/** Notifications to UI clients (`ui.*`). */
export interface UiSink {
  emit(event: UiEvent, payload: unknown): void;
}

export interface CallContext {
  role: Role;
  connId: string;
  /** Agent session proven by the per-session MCP token the connection authenticated with. */
  callerSessionId?: string;
}

export const DEFAULT_HOST_TIMEOUT_MS = 10_000;
export const HOST_TIMEOUTS: Partial<Record<HostMethod, number>> = {
  'host.systemSpeak': 60_000,
  'host.screenshot': 20_000,
};

/** Binary frame layout shared with the shell: exactly 16 ASCII bytes of utterance id, then the payload. */
export function encodeAudioFrame(utteranceId: string, chunk: Uint8Array): Buffer {
  if (!/^[\x20-\x7e]{16}$/.test(utteranceId)) throw new Error('utteranceId must be exactly 16 ASCII characters');
  return Buffer.concat([Buffer.from(utteranceId, 'ascii'), Buffer.from(chunk)]);
}

export function decodeAudioFrame(frame: Uint8Array): { utteranceId: string; payload: Uint8Array } {
  return {
    utteranceId: Buffer.from(frame.subarray(0, 16)).toString('ascii'),
    payload: frame.subarray(16),
  };
}

/** Host used when no shell is attached (headless dev, CLI tests): every call fails fast. */
export const offlineHost: HostClient = {
  connected: false,
  call: async (method) => {
    throw new Error(`shell not connected (${method})`);
  },
  sendAudio: () => undefined,
};
