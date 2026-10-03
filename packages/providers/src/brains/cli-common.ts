import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BrainMessage, ProviderError } from '@jarvis/core';
import { ProcessAbortedError } from '../util/process.js';

/** Flattens the non-system conversation into a single stdin prompt. */
export function transcript(messages: readonly BrainMessage[]): string {
  const turns = messages.filter((m) => m.role !== 'system');
  if (turns.length === 1 && turns[0]?.role === 'user') return turns[0].content;
  return turns.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
}

export const systemText = (messages: readonly BrainMessage[]): string =>
  messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');

/** Private temp dir (owner-only), removed by `cleanup()`. Also used as the CLI's cwd so no project files leak in. */
export async function privateTempDir(
  prefix: string,
): Promise<{ dir: string; write(name: string, content: string): Promise<string>; cleanup(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return {
    dir,
    async write(name, content) {
      const p = join(dir, name);
      await writeFile(p, content, { mode: 0o600 });
      return p;
    },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/** Classifies CLI failure text into a ProviderError code. */
export function classifyCliFailure(text: string): ProviderError['code'] {
  if (
    /not logged in|log ?in required|please (run|use) .*login|\/login|unauthori[sz]ed|authentication|invalid api key|oauth token/i.test(
      text,
    )
  )
    return 'needs-login';
  if (/usage limit|limit reached|rate.?limit|quota|out of (extra )?usage|too many requests|\b429\b/i.test(text))
    return 'cap-reached';
  return 'bad-response';
}

export function mapProcessError(err: unknown, provider: string): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof ProcessAbortedError) {
    return err.reason === 'aborted'
      ? new ProviderError('Request cancelled', 'aborted', provider)
      : new ProviderError('The CLI did not answer in time', 'network', provider);
  }
  const code = (err as { code?: string }).code;
  if (code === 'ENOENT' || code === 'EACCES')
    return new ProviderError('CLI not found or not executable', 'not-configured', provider);
  return new ProviderError(err instanceof Error ? err.message : String(err), 'unknown', provider);
}

/** Last non-empty lines of stderr, for diagnostics (never includes the prompt, which went to stdin). */
export const tail = (s: string, n = 400): string => s.trim().slice(-n);
