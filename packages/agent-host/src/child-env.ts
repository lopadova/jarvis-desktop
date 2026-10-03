/**
 * Minimal, allowlisted environment for every child process the sidecar spawns (agents, MCP servers).
 * Children never inherit the launch token or other JARVIS_* values (except JARVIS_MCP_COMMAND), and
 * agents never receive pay-per-use API keys (R6, R10).
 */

const ALLOW_EXACT = new Set(
  [
    'PATH',
    'PATHEXT',
    'HOME',
    'USER',
    'USERNAME',
    'LOGNAME',
    'SHELL',
    'TERM',
    'TZ',
    'LANG',
    'LANGUAGE',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'APPDATA',
    'LOCALAPPDATA',
    'PROGRAMDATA',
    'PROGRAMFILES',
    'PROGRAMFILES(X86)',
    'COMMONPROGRAMFILES',
    'SYSTEMROOT',
    'SYSTEMDRIVE',
    'WINDIR',
    'COMSPEC',
    'TEMP',
    'TMP',
    'TMPDIR',
    'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE',
    'OS',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'ALL_PROXY',
    'NODE_EXTRA_CA_CERTS',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'CLAUDE_CONFIG_DIR',
    'CODEX_HOME',
    'JARVIS_MCP_COMMAND',
  ].map((k) => k.toUpperCase()),
);
const ALLOW_PREFIX = ['LC_', 'XDG_'];
/** The only JARVIS_* variable a generic child may see (a path, not a secret). */
const EXTRA_JARVIS_OK = new Set(['JARVIS_MCP_COMMAND']);

export const AGENT_DROPPED_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];

export function safeChildEnv(
  extra: Record<string, string> = {},
  opts: { drop?: string[]; source?: NodeJS.ProcessEnv } = {},
): Record<string, string> {
  const source = opts.source ?? process.env;
  const drop = new Set((opts.drop ?? []).map((k) => k.toUpperCase()));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined) continue;
    const K = k.toUpperCase();
    if (drop.has(K)) continue;
    if (ALLOW_EXACT.has(K) || ALLOW_PREFIX.some((p) => K.startsWith(p))) env[k] = v;
  }
  for (const [k, v] of Object.entries(extra)) if (!drop.has(k.toUpperCase())) env[k] = v;
  // Defence in depth: whatever the sources, no JARVIS_* value except the MCP command path. The Jarvis
  // MCP bridge receives its port/session token through the agent's MCP server config, not through here.
  for (const k of Object.keys(env)) {
    const K = k.toUpperCase();
    if (K.startsWith('JARVIS_') && !EXTRA_JARVIS_OK.has(K)) delete env[k];
  }
  return env;
}
