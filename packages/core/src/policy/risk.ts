import type { ApprovalKind, PermissionLevel, RiskLevel } from '../model.js';

/**
 * Risk classification for agent permission requests (security-model R1/R2).
 * Conservative by design: anything not recognised as harmless is at least `medium`.
 */

const HIGH_RISK_SHELL: RegExp[] = [
  /\brm\s+(-[a-z]*r[a-z]*f?|-[a-z]*f[a-z]*r)\b/i, // rm -rf / -fr
  /\brm\s+-r\b/i,
  /\bsudo\b/i,
  /\bdoas\b/i,
  /\bmkfs\b|\bdd\s+if=|\bformat\s+[a-z]:/i,
  /\bchmod\s+-R\b|\bchown\s+-R\b/i,
  /\bgit\s+push\b|\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-[a-z]*f/i,
  /\b(npm|pnpm|yarn|bun)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b/i,
  /\bcurl\b[^|]*\|\s*(ba|z)?sh\b|\bwget\b[^|]*\|\s*(ba|z)?sh\b|\biwr\b.*\|\s*iex\b/i,
  /\b(shutdown|reboot|halt)\b/i,
  /\bRemove-Item\b.*-Recurse/i,
  /\bdel\s+\/[sq]/i,
  /\brmdir\s+\/s/i,
  /\b(security|keychain)\s+(delete|dump|find-generic-password)/i,
  /\bcrontab\s+-r\b|\bsystemctl\s+(disable|stop|mask)\b|\blaunchctl\s+(unload|remove)\b/i,
  /\bkill\s+-9\s+-?1\b|\bkillall\b/i,
  /(^|\s)>\s*\/(etc|usr|bin|System)\//,
  /\b(aws|gcloud|az)\b.*\b(delete|destroy|terminate)\b/i,
  /\bterraform\s+(apply|destroy)\b|\bkubectl\s+delete\b/i,
];

const SENSITIVE_PATHS: RegExp[] = [
  /(^|[\\/])\.ssh([\\/]|$)/i,
  /(^|[\\/])\.aws([\\/]|$)/i,
  /(^|[\\/])\.gnupg([\\/]|$)/i,
  /(^|[\\/])\.config[\\/]gcloud/i,
  /(^|[\\/])\.env(\.|$)/i,
  /id_(rsa|ed25519|ecdsa)/i,
  /\.(pem|key|p12|pfx|kdbx)$/i,
  /(^|[\\/])(etc|System|Windows)[\\/]/i,
  /Library[\\/]Keychains/i,
];

const NETWORK_SHELL: RegExp[] = [/\b(curl|wget|iwr|Invoke-WebRequest|nc|ncat|scp|rsync|ssh|ftp|sftp)\b/i];

/** Commands that only read. Package scripts (`npm test`, `pnpm build`) run arbitrary code, so they are NOT here. */
const READONLY_SHELL: RegExp[] = [
  /^\s*(ls|dir|pwd|cat|type|head|tail|wc|echo|which|where|whoami|date|tree|find|rg|grep|git\s+(status|log|diff|show|branch))\b/i,
  /^\s*(node|python3?|bun|deno|php|ruby)\s+(-v|--version)\s*$/i,
];

/**
 * Shell syntax that chains, substitutes or redirects — newlines and carriage returns separate commands too.
 * Any of these makes a command compound: it can never be low risk or allowlisted.
 */
const COMPOUND = /[;&|`\n\r<>]|\$\(|\$\{|\$['"]/;

/** Flags that turn otherwise read-only tools into executors or writers (find -exec, rg --pre, git -c, tree -o …). */
const EXEC_FLAGS =
  /(^|\s)(-exec|-execdir|-ok|-okdir|-delete|-fprint\w*|-fls|--pre(=|\s)|--pre-glob|--output|-o\s|--ext-diff|--textconv|--upload-pack|--exec|-c\s|--config)/i;

/** What the program receives after the shell strips quotes and backslash escapes. */
export const deQuote = (cmd: string): string => cmd.replace(/["'\\]/g, '');
const firstToken = (cmd: string): string => cmd.trim().split(/\s+/)[0] ?? '';

export const isCompoundCommand = (cmd: string): boolean => COMPOUND.test(cmd);

/**
 * Read-only tools whose *arguments* can still mutate state: only listed argument forms stay read-only.
 * `git branch -D x` deletes, `date -s …` sets the clock, `git show`/`log` accept `--output`, etc.
 */
function mutatingArgs(cmd: string): boolean {
  const t = cmd.trim();
  if (/^git\s+branch\b/i.test(t)) {
    const args = t.split(/\s+/).slice(2);
    return !args.every((a) =>
      /^(-a|-r|-v|-vv|--all|--remotes|--list|--show-current|--verbose|--no-color|--color)$/.test(a),
    );
  }
  if (/^date\b/i.test(t)) return /(^|\s)(-s|--set|-u\s+\d|\d{6,})/.test(t);
  return false;
}

export interface RiskInput {
  kind: ApprovalKind;
  detail: string;
  /** For file operations: whether the target is inside the project folder. */
  insideProject?: boolean;
  /** For MCP tools: annotation hints from the tool definition. */
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}

export function classifyRisk(input: RiskInput): RiskLevel {
  const d = input.detail;
  switch (input.kind) {
    case 'shell': {
      // Quotes and backslashes are removed by the shell before a program sees its arguments, so `r""m -rf`,
      // `-e"x"ec` or `'-exec'` must be judged as `rm -rf` / `-exec`. Classify the de-quoted form.
      const n = deQuote(d);
      if (HIGH_RISK_SHELL.some((r) => r.test(d) || r.test(n))) return 'high';
      if (SENSITIVE_PATHS.some((r) => r.test(d) || r.test(n))) return 'high';
      if (isCompoundCommand(d) && NETWORK_SHELL.some((r) => r.test(n))) return 'high';
      if (
        READONLY_SHELL.some((r) => r.test(n)) &&
        !isCompoundCommand(d) &&
        !EXEC_FLAGS.test(n) &&
        !mutatingArgs(n) &&
        !/[*?[\]]/.test(firstToken(d))
      )
        return 'low';
      return 'medium';
    }
    case 'file-delete':
      return input.insideProject && !SENSITIVE_PATHS.some((r) => r.test(d)) ? 'medium' : 'high';
    case 'file-write':
      if (SENSITIVE_PATHS.some((r) => r.test(d))) return 'high';
      return input.insideProject ? 'low' : 'high';
    case 'network':
      return /\b(POST|PUT|PATCH|DELETE)\b/.test(d) ? 'high' : 'medium';
    case 'mcp-tool':
      if (input.destructiveHint) return 'high';
      if (input.readOnlyHint) return 'low';
      return 'medium';
  }
}

export type GateDecision = 'allow' | 'ask' | 'deny';

/**
 * What to do with a request before asking the user, given the project's permission level.
 * - safe:      in-project writes allowed; everything else asks.
 * - trusted:   low risk allowed, allowlisted shell allowed, medium/high asks.
 * - full-auto: everything allowed except `high`, which still asks (never silently destructive).
 */
export function gate(
  level: PermissionLevel,
  risk: RiskLevel,
  input: RiskInput,
  allowlist: readonly string[] = [],
): GateDecision {
  if (risk === 'high') return 'ask';
  if (input.kind === 'file-write' && input.insideProject && risk === 'low') return 'allow';
  if (level === 'full-auto') return 'allow';
  if (level === 'trusted') {
    if (risk === 'low') return 'allow';
    if (input.kind === 'shell' && isAllowlisted(input.detail, allowlist)) return 'allow';
    return 'ask';
  }
  return 'ask';
}

export function isAllowlisted(command: string, allowlist: readonly string[]): boolean {
  const c = command.trim();
  if (isCompoundCommand(command)) return false; // never allowlist compound commands (incl. newline-separated)
  return allowlist.some((prefix) => {
    const p = prefix.trim();
    return p.length > 0 && (c === p || c.startsWith(`${p} `));
  });
}

/** Voice approval is only acceptable for low/medium risk (R2). */
export const voiceApprovalAllowed = (risk: RiskLevel): boolean => risk !== 'high';
/** "Always allow in this project" is never offered for high risk (R2). */
export const alwaysAllowOffered = (risk: RiskLevel): boolean => risk !== 'high';
