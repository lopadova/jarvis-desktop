import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const b64url = (buf: Buffer): string => buf.toString('base64url');

/** RFC 7636 code verifier: 32 random bytes → 43 base64url characters. */
export const createCodeVerifier = (): string => b64url(randomBytes(32));

/** S256 challenge: BASE64URL(SHA256(verifier)). */
export const codeChallengeS256 = (verifier: string): string => b64url(createHash('sha256').update(verifier).digest());

/** Opaque random value for `state` / `nonce` (256 bits). */
export const randomToken = (): string => b64url(randomBytes(32));

export interface PkceSession {
  verifier: string;
  challenge: string;
  state: string;
  nonce: string;
}

export function createPkceSession(): PkceSession {
  const verifier = createCodeVerifier();
  return { verifier, challenge: codeChallengeS256(verifier), state: randomToken(), nonce: randomToken() };
}

/** Constant-time string comparison (state/nonce checks). */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
