/** Tiny HTML helpers: self-contained pages (no external assets) and security headers. */

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--fg:#111827;--muted:#4b5563;--accent:#0369a1;--err:#b91c1c;--border:#d1d5db}
@media (prefers-color-scheme:dark){:root{--bg:#0b1020;--card:#111827;--fg:#f3f4f6;--muted:#9ca3af;--accent:#38bdf8;--err:#f87171;--border:#374151}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:30rem;margin:3rem auto;padding:0 1rem}.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1.5rem}
h1{font-size:1.4rem;margin:0 0 .75rem}p{margin:.5rem 0}.muted{color:var(--muted);font-size:.95rem}
label{display:block;font-weight:600;margin:1rem 0 .35rem}
input[type=text]{width:100%;font:600 1.4rem/1.2 ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;padding:.6rem .75rem;border:2px solid var(--border);border-radius:8px;background:transparent;color:inherit}
input[type=text]:focus-visible,button:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.actions{display:flex;gap:.75rem;margin-top:1.25rem}
button{font:inherit;font-weight:600;padding:.6rem 1.1rem;border-radius:8px;border:2px solid var(--accent);cursor:pointer}
.primary{background:var(--accent);color:#fff}.secondary{background:transparent;color:var(--fg)}
.error{color:var(--err);font-weight:600}.warn{border-left:4px solid var(--err);padding-left:.75rem}
code{font-family:ui-monospace,monospace;word-break:break-all}`;

export function page(title: string, body: string, status = 200, extraHeaders?: HeadersInit): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><main><div class="card">${body}</div></main></body></html>`;
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(html, { status, headers });
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000',
  // No scripts at all; inline styles only. form-action is not restricted because the authorize form
  // redirects to the OAuth client (e.g. chatgpt.com) and browsers apply form-action to redirects.
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

/** Adds security headers to any response except WebSocket upgrades. */
export function withSecurityHeaders(response: Response): Response {
  if (response.status === 101 || (response as { webSocket?: unknown }).webSocket) return response;
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!secured.headers.has(name)) secured.headers.set(name, value);
  }
  return secured;
}
