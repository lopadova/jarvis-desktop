// Fake `claude` / `codex` CLI for tests. Records argv, stdin and env to $FAKE_REPORT and prints a
// canned reply selected by $FAKE_MODE.
import { readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
let stdin = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) stdin += chunk;

const after = (flag) => {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
};
const sysFile = after('--system-prompt-file');
const schemaFile = after('--output-schema');
const mode = process.env.FAKE_MODE ?? '';

if (process.env.FAKE_REPORT) {
  writeFileSync(
    process.env.FAKE_REPORT,
    JSON.stringify({
      argv,
      stdin,
      cwd: process.cwd(),
      env: {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? null,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? null,
        CODEX_API_KEY: process.env.CODEX_API_KEY ?? null,
        JARVIS_LAUNCH_TOKEN: process.env.JARVIS_LAUNCH_TOKEN ?? null,
        MAX_THINKING_TOKENS: process.env.MAX_THINKING_TOKENS ?? null,
      },
      systemPromptFile: sysFile ?? null,
      systemPrompt: sysFile ? readFileSync(sysFile, 'utf8') : null,
      schemaFile: schemaFile ?? null,
      schema: schemaFile ? readFileSync(schemaFile, 'utf8') : null,
    }),
  );
}

if (argv[0] === '--version') {
  console.log('9.9.9 (fake)');
  process.exit(0);
}
if (argv[0] === 'auth') {
  console.log(JSON.stringify({ loggedIn: mode !== 'logged-out', email: 'me@example.com', subscriptionType: 'max' }));
  process.exit(0);
}
if (argv[0] === 'login') {
  console.log(mode === 'logged-out' ? 'Not logged in' : 'Logged in using ChatGPT');
  process.exit(mode === 'logged-out' ? 1 : 0);
}

const isCodex = argv[0] === 'exec';
if (mode === 'limit') {
  if (isCodex) {
    console.log(JSON.stringify({ type: 'turn.failed', error: { message: "You've hit your usage limit." } }));
  } else {
    console.log(
      JSON.stringify({
        type: 'result',
        is_error: true,
        api_error_status: 429,
        result: 'Claude AI usage limit reached',
      }),
    );
  }
  process.exit(1);
}
if (mode === 'hang') {
  setTimeout(() => {}, 60_000);
} else if (isCodex) {
  console.log(JSON.stringify({ type: 'thread.started', thread_id: 't1' }));
  console.log(JSON.stringify({ type: 'turn.started' }));
  console.log(JSON.stringify({ type: 'item.completed', item: { id: 'i0', type: 'reasoning', text: 'thinking' } }));
  console.log(
    JSON.stringify({
      type: 'item.completed',
      item: { id: 'i1', type: 'agent_message', text: '{"speak":"from codex"}' },
    }),
  );
  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 7, output_tokens: 3 } }));
} else {
  const structured = argv.includes('--json-schema');
  console.log(
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: structured ? '{"speak":"from claude"}' : 'plain reply',
      ...(structured ? { structured_output: { speak: 'from claude' } } : {}),
      usage: { input_tokens: 11, output_tokens: 4 },
    }),
  );
}
