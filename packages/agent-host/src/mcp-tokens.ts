/**
 * Per-session MCP tokens. Each agent session gets its own random token, passed ONLY through the env of
 * the Jarvis MCP server attached to that agent (JARVIS_MCP_SESSION_TOKEN). When the bridge connects
 * with it, the sidecar knows the calling session for certain and caps what that session may start.
 * Calls without a verified session token are treated as external (fail closed).
 */
import { randomToken } from './util.js';

export class McpSessionTokens {
  private readonly byToken = new Map<string, string>();
  private readonly bySession = new Map<string, string>();

  issue(sessionId: string): string {
    const existing = this.bySession.get(sessionId);
    if (existing) return existing;
    const token = randomToken(32);
    this.byToken.set(token, sessionId);
    this.bySession.set(sessionId, token);
    return token;
  }

  resolve(token: string): string | undefined {
    return this.byToken.get(token);
  }

  revoke(sessionId: string): void {
    const t = this.bySession.get(sessionId);
    if (t) this.byToken.delete(t);
    this.bySession.delete(sessionId);
  }
}
