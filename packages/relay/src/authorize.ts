/**
 * OAuth authorize page: the consent step is "type the pairing code shown by Jarvis".
 *
 * GET  /authorize — validates the OAuth request (workers-oauth-provider), starts a consent
 *                   transaction (single-use handle bound to this browser by a __Host- cookie) and
 *                   shows the form.
 * POST /authorize — Deny → redirect with access_denied. Allow → the code must match a registered
 *                   pair; the grant is then bound to that pairId (props.pairId).
 */
import { AuthorizationError, type AuthRequest, CimdFetchError } from '@cloudflare/workers-oauth-provider';
import { type Env, type GrantProps, registryStub } from './env.js';
import { escapeHtml, page } from './shared/html.js';
import { normalizePairingCode } from './shared/pairing.js';

export const SCOPE = 'jarvis';

interface FormDetails {
  clientName: string;
  redirectHost: string;
  redirectIsLoopback: boolean;
}

function authorizeForm(details: FormDetails, handle: string, error?: string): string {
  const client = escapeHtml(details.clientName || 'An app');
  return `<h1>Connect ${client} to Jarvis</h1>
<p>${client} wants to use Jarvis on your computer. Access will be sent to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
${details.redirectIsLoopback ? '<p class="warn">This sends access to an app on this computer. Continue only if you just started connecting from it.</p>' : ''}
<p class="muted">Open Jarvis → Settings → ChatGPT relay to see your pairing code. Every call made through this connection is shown in Jarvis, and risky actions still need your approval there.</p>
<form method="post" action="/authorize">
  <input type="hidden" name="handle" value="${escapeHtml(handle)}">
  <label for="code">Pairing code</label>
  <input id="code" name="code" type="text" inputmode="text" autocomplete="one-time-code" autocapitalize="characters"
    spellcheck="false" maxlength="12" required aria-describedby="code-help${error ? ' code-error' : ''}"${error ? ' aria-invalid="true" autofocus' : ''}>
  <p id="code-help" class="muted">8 characters, letters A–Z and digits 2–7.</p>
  ${error ? `<p id="code-error" class="error" role="alert">${escapeHtml(error)}</p>` : ''}
  <div class="actions">
    <button class="primary" type="submit" name="decision" value="approve">Connect</button>
    <button class="secondary" type="submit" name="decision" value="deny" formnovalidate>Cancel</button>
  </div>
</form>`;
}

function errorPage(message: string, status = 400): Response {
  return page('Cannot connect', `<h1>Cannot connect</h1><p>${escapeHtml(message)}</p>`, status);
}

export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (request.method === 'GET') {
      const authRequest: AuthRequest = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(authRequest);
      const consent = await oauth.beginConsent(authRequest);
      return page('Connect to Jarvis', authorizeForm(details, consent.handle), 200, consent.headers);
    }
    if (request.method !== 'POST')
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } });

    const form = await request.formData();
    const handle = String(form.get('handle') ?? '');
    if (form.get('decision') !== 'approve') {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }

    const code = normalizePairingCode(String(form.get('code') ?? ''));
    const match = code ? await registryStub(env).findByCode(code) : 'not-found';
    if (match === 'throttled') return errorPage('Too many wrong pairing codes. Wait 10 minutes and try again.', 429);
    if (match === 'not-found') {
      // The handle has not been used yet, so the same form can be shown again.
      return page(
        'Connect to Jarvis',
        authorizeForm(
          { clientName: 'This app', redirectHost: 'the app that started this connection', redirectIsLoopback: false },
          handle,
          "That pairing code doesn't match any paired computer. Check the code in Jarvis and try again.",
        ),
        400,
      );
    }

    const approved = await oauth.approveConsent(request, handle, { scope: [SCOPE] });
    const props: GrantProps = { pairId: match.pairId, generation: match.generation };
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: match.pairId,
      metadata: { label: match.label },
      scope: [SCOPE],
      props,
    });
    approved.headers.set('Location', redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError) return errorPage(error.description);
    if (error instanceof CimdFetchError) return errorPage('This app could not be verified.');
    throw error;
  }
}
