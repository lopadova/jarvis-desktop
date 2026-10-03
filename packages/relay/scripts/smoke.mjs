// End-to-end smoke test against a running relay (default: `wrangler dev` on http://localhost:8787).
//   pnpm --filter @jarvis/relay dev            # terminal 1
//   pnpm --filter @jarvis/relay smoke [url]    # terminal 2 (Node ≥ 22)
// Pairs a fake desktop, runs the OAuth flow with the pairing code, then calls a tool through /mcp.
import { createHash, randomBytes } from 'node:crypto';

const BASE = (process.argv[2] ?? 'http://localhost:8787').replace(/\/$/, '');
const REDIRECT = 'http://127.0.0.1:9/callback';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const base32 = (buf) => {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return bits ? out + ALPHABET[(value << (5 - bits)) & 31] : out;
};
const step = (msg) => console.log(`• ${msg}`);
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

const pairId = base32(randomBytes(16)).toLowerCase();
const secret = randomBytes(32).toString('base64url');
const digest = createHash('sha256').update(secret).digest();
const code = base32(digest).slice(0, 8);

let res = await fetch(`${BASE}/pair/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ pairId, secretHash: digest.toString('hex'), label: 'smoke test' }),
});
if (res.status !== 201) fail(`register → ${res.status}`);
step(`registered pair ${pairId} (code ${code})`);

const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/desktop/connect?pairId=${pairId}`, {
  headers: { Authorization: `Bearer ${secret}` },
});
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error('desktop WebSocket failed'));
}).catch((e) => fail(e.message));
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'call') {
    step(`desktop received call ${msg.tool} from ${msg.client}`);
    ws.send(
      JSON.stringify({ type: 'result', id: msg.id, ok: true, content: [{ type: 'text', text: 'pong from desktop' }] }),
    );
  }
};
ws.send(JSON.stringify({ type: 'hello', version: 'smoke', tools: [{ name: 'jarvis_recall', readOnly: true }] }));
step('desktop connected and sent hello');

res = await fetch(`${BASE}/oauth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ client_name: 'smoke', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }),
});
const { client_id: clientId } = await res.json();
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const query = new URLSearchParams({
  response_type: 'code',
  client_id: clientId,
  redirect_uri: REDIRECT,
  scope: 'jarvis',
  state: 'smoke',
  code_challenge: challenge,
  code_challenge_method: 'S256',
});
res = await fetch(`${BASE}/authorize?${query}`);
const html = await res.text();
const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1];
if (!handle) fail(`authorize page → ${res.status}`);
const cookie = res.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');
res = await fetch(`${BASE}/authorize`, {
  method: 'POST',
  redirect: 'manual',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
  body: new URLSearchParams({ handle, code, decision: 'approve' }),
});
const authCode = new URL(res.headers.get('location') ?? 'x:/').searchParams.get('code');
if (!authCode)
  fail(`authorize POST → ${res.status} (cookies need https on some runtimes; try wrangler dev --local-protocol https)`);
res = await fetch(`${BASE}/oauth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code: authCode,
    redirect_uri: REDIRECT,
    client_id: clientId,
    code_verifier: verifier,
  }),
});
const { access_token: token } = await res.json();
if (!token) fail(`token → ${res.status}`);
step('OAuth flow completed with the pairing code');

const rpc = async (method, params) =>
  (
    await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'openai-mcp smoke',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
  ).json();
const tools = await rpc('tools/list');
step(`tools/list → ${tools.result.tools.map((t) => t.name).join(', ')}`);
const result = await rpc('tools/call', { name: 'jarvis_recall', arguments: {} });
if (result.result?.content?.[0]?.text !== 'pong from desktop') fail(`tools/call → ${JSON.stringify(result)}`);
step('tools/call round trip OK');

await fetch(`${BASE}/pair/register?pairId=${pairId}`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${secret}` },
});
ws.close();
console.log('✓ smoke test passed');
