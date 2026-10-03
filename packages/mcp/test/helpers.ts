import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';

export interface ReceivedCall {
  protocol: string;
  method: string;
  params: Record<string, unknown>;
}

/** A stand-in for the agent-host sidecar: accepts only `jarvis.<token>` and answers `mcp.call`. */
export async function startFakeSidecar(token: string, reply: (call: ReceivedCall) => unknown = () => ({ ok: true })) {
  const calls: ReceivedCall[] = [];
  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port: 0,
    handleProtocols: (protocols) => (protocols.has(`jarvis.${token}`) ? `jarvis.${token}` : false),
    verifyClient: (info, done) => {
      const offered = String(info.req.headers['sec-websocket-protocol'] ?? '')
        .split(',')
        .map((p) => p.trim());
      // Mirrors the real agent-host: the role comes from `?role=`, and without it the client would be treated as `ui`.
      const role = new URL(info.req.url ?? '/', 'http://127.0.0.1').searchParams.get('role');
      if (offered.includes(`jarvis.${token}`) && role === 'mcp') done(true);
      else done(false, 401, 'Unauthorized');
    },
  });
  wss.on('connection', (socket) => {
    socket.on('message', async (data) => {
      const msg = JSON.parse(data.toString()) as { id: number; method: string; params: Record<string, unknown> };
      const call = { protocol: socket.protocol, method: msg.method, params: msg.params };
      calls.push(call);
      const result = await reply(call);
      if (result === undefined) return; // never answer (timeout tests)
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    });
  });
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  const port = (wss.address() as AddressInfo).port;
  return {
    port,
    calls,
    wss,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}
