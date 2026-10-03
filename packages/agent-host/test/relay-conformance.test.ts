/**
 * Desktop link client ⇄ reference relay conformance (relay-protocol.md §1, §2, §5): the desktop's
 * hashing, pairing code, registration body and frames are checked against the relay's own shared
 * parsing code (packages/relay/src/shared/pairing.ts, Web Crypto only, so it runs under Node too).
 */
import { randomBytes } from 'node:crypto';
import { McpTools } from '@jarvis/core';
import { describe, expect, it } from 'vitest';
import { TOOL_CATALOG } from '../../relay/src/shared/catalog.generated.js';
import {
  PAIR_ID_RE,
  pairingCodeFromHash,
  parseDesktopMessage,
  parseRegistration,
  sha256Hex as relaySha256Hex,
} from '../../relay/src/shared/pairing.js';
import { base32, MAX_FRAME, pairingCode, resultFrame, sha256Hex } from '../src/relay.js';
import { makeApp } from './helpers.js';

describe('relay protocol conformance', () => {
  it('secretHash and the pairing code match what the relay derives (§5)', async () => {
    for (let i = 0; i < 20; i++) {
      const secret = randomBytes(32).toString('base64url');
      const hash = sha256Hex(secret);
      expect(hash).toBe(await relaySha256Hex(secret));
      expect(pairingCode(secret)).toBe(pairingCodeFromHash(hash));
    }
  });

  it('a desktop pairId passes the relay validation', () => {
    for (let i = 0; i < 20; i++) expect(base32(randomBytes(16))).toMatch(PAIR_ID_RE);
  });

  it('the POST /pair/register body is accepted by the relay parser', async () => {
    let body: unknown;
    const t = await makeApp({
      relay: {
        fetch: (async (_u: unknown, init?: RequestInit) => {
          body = JSON.parse(String(init?.body));
          return new Response(null, { status: 201 });
        }) as typeof fetch,
        connect: () =>
          ({ on: () => undefined, removeAllListeners: () => undefined, terminate: () => undefined }) as never,
      },
    });
    await t.app.relay.pair('http://127.0.0.1:1');
    const parsed = parseRegistration(body);
    expect(typeof parsed).toBe('object');
    expect(parsed).toMatchObject({ pairId: (body as { pairId: string }).pairId });
  });

  it('hello, result and ping frames parse on the relay side; hello lists only read-only tools by default', async () => {
    const t = await makeApp();
    const hello = parseDesktopMessage(
      JSON.stringify({ type: 'hello', version: '0.1.0', tools: t.app.relay.helloTools() }),
    );
    expect(hello?.type).toBe('hello');
    const names = hello?.type === 'hello' ? hello.tools.map((x) => x.name) : [];
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(McpTools[n as keyof typeof McpTools].readOnly).toBe(true);
    // Every name we announce exists in the relay's catalogue (otherwise tools/list would drop it).
    for (const n of names) expect(TOOL_CATALOG.some((c) => c.name === n)).toBe(true);
    t.app.updateSettings({ relayExposeWriteTools: true });
    expect(t.app.relay.helloTools().some((x) => !x.readOnly)).toBe(true);

    const ok = parseDesktopMessage(resultFrame('id1', { content: [{ type: 'text', text: 'x' }] }));
    expect(ok).toMatchObject({ type: 'result', id: 'id1', ok: true, content: [{ type: 'text', text: 'x' }] });
    const err = parseDesktopMessage(resultFrame('id2', { content: [{ type: 'text', text: 'bad' }], isError: true }));
    expect(err).toMatchObject({ type: 'result', id: 'id2', ok: false, error: 'bad' });
    expect(parseDesktopMessage(JSON.stringify({ type: 'ping', t: 5 }))).toEqual({ type: 'ping', t: 5 });
    const huge = resultFrame('id3', { content: [{ type: 'text', text: 'é'.repeat(80_000) }] });
    expect(Buffer.byteLength(huge)).toBeLessThanOrEqual(MAX_FRAME);
  });
});
