#!/usr/bin/env node
// Fake `codex app-server` for tests: speaks the same newline-delimited JSON-RPC as codex-cli 0.159.
// The scenario is read from ./scenario.json in the working directory (the driver passes the session
// cwd); every message received and some environment facts are appended to ./received.jsonl.
import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const scenario = JSON.parse(readFileSync('scenario.json', 'utf8'));
const log = (entry) => appendFileSync('received.jsonl', `${JSON.stringify(entry)}\n`);
log({
  kind: 'env',
  argv: process.argv.slice(2),
  hasOpenAiKey: 'OPENAI_API_KEY' in process.env,
  jarvisVars: Object.keys(process.env).filter((k) => k.toUpperCase().startsWith('JARVIS_')),
});
if (scenario.mode === 'exit-at-start') process.exit(3);

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const notify = (method, params) => send({ method, params });
const waiting = new Map();
let serverRequestId = 100;
const ask = (method, params) =>
  new Promise((resolve) => {
    const id = serverRequestId++;
    waiting.set(id, resolve);
    send({ method, id, params });
  });

let threadId = 'thr_fake_1';
const turnId = 'turn_fake_1';

async function runTurn() {
  notify('turn/started', { threadId, turn: { id: turnId, items: [], status: 'inProgress', error: null } });
  if (scenario.mode === 'hang') return;
  for (const step of scenario.steps ?? []) {
    if (step.type === 'command') {
      notify('item/started', {
        threadId,
        turnId,
        item: {
          type: 'commandExecution',
          id: step.itemId,
          command: step.command,
          commandActions: [{ type: 'unknown', command: step.command }],
        },
      });
      const r = await ask('item/commandExecution/requestApproval', {
        kind: 'command',
        threadId,
        turnId,
        itemId: step.itemId,
        command: step.command,
        cwd: process.cwd(),
        ...(step.networkHost ? { networkApprovalContext: { host: step.networkHost, protocol: 'https' } } : {}),
      });
      log({ kind: 'decision', step: step.itemId, result: r });
    } else if (step.type === 'fileChange') {
      notify('item/started', {
        threadId,
        turnId,
        item: { type: 'fileChange', id: step.itemId, changes: step.changes, status: 'inProgress' },
      });
      const r = await ask('item/fileChange/requestApproval', {
        threadId,
        turnId,
        itemId: step.itemId,
        reason: null,
        grantRoot: null,
      });
      log({ kind: 'decision', step: step.itemId, result: r });
    } else if (step.type === 'mcp') {
      notify('item/started', {
        threadId,
        turnId,
        item: { type: 'mcpToolCall', id: step.itemId, server: step.server, tool: step.tool, readOnlyHint: false },
      });
      const r = await ask('mcpServer/elicitation/request', {
        threadId,
        turnId,
        serverName: step.server,
        mode: 'form',
        _meta: step.approval === false ? null : { codex_approval_kind: 'mcp_tool_call', tool_params: {} },
        message: `Allow the ${step.server} MCP server to run tool "${step.tool}"?`,
        requestedSchema: { type: 'object', properties: {} },
      });
      log({ kind: 'decision', step: step.itemId, result: r });
      notify('item/completed', {
        threadId,
        turnId,
        item: { type: 'mcpToolCall', id: step.itemId, server: step.server, tool: step.tool, status: 'completed' },
      });
    } else if (step.type === 'unknownRequest') {
      const r = await new Promise((resolve) => {
        const id = serverRequestId++;
        waiting.set(id, resolve);
        send({ method: 'item/tool/call', id, params: { threadId } });
      });
      log({ kind: 'decision', step: 'unknown', result: r });
    }
  }
  notify('item/completed', {
    threadId,
    turnId,
    item: { type: 'agentMessage', id: 'msg_1', text: scenario.finalText ?? 'Done.', phase: 'final_answer' },
  });
  notify('turn/completed', {
    threadId,
    turn: { id: turnId, items: [], status: scenario.turnStatus ?? 'completed', error: scenario.turnError ?? null },
  });
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  log({ kind: 'recv', msg });
  if (msg.method === undefined && msg.id !== undefined) {
    const resolve = waiting.get(msg.id);
    waiting.delete(msg.id);
    resolve?.(msg.error ? { error: msg.error } : msg.result);
    return;
  }
  switch (msg.method) {
    case 'initialize':
      send({
        id: msg.id,
        result: { userAgent: 'fake/0', codexHome: '/tmp', platformFamily: 'unix', platformOs: 'linux' },
      });
      return;
    case 'initialized':
      return;
    case 'thread/start':
    case 'thread/resume':
      if (scenario.mode === 'no-thread') {
        send({ id: msg.id, error: { code: -32600, message: 'unknown method' } });
        return;
      }
      if (msg.params.threadId) threadId = msg.params.threadId;
      send({ id: msg.id, result: { thread: { id: threadId } } });
      notify('thread/started', { thread: { id: threadId } });
      return;
    case 'turn/start':
      send({ id: msg.id, result: { turn: { id: turnId, items: [], status: 'inProgress', error: null } } });
      void runTurn();
      return;
    case 'turn/interrupt':
      send({ id: msg.id, result: {} });
      notify('turn/completed', { threadId, turn: { id: turnId, items: [], status: 'interrupted', error: null } });
      return;
    default:
      if (msg.id !== undefined) send({ id: msg.id, error: { code: -32601, message: 'not found' } });
  }
});
rl.on('close', () => process.exit(0));
