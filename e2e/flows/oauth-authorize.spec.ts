import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { loginAsSeedUser } from '../support/auth';

/**
 * OAuth 2.1 authorize + consent flow against a real browser.
 *
 * Registers a public client via Dynamic Client Registration (RFC 7591),
 * computes a PKCE S256 pair (RFC 7636), then drives the /oauth/authorize
 * consent screen: it must gate behind /login when unauthenticated, render the
 * scope-aware consent screen after login, and redirect back to the registered
 * redirect_uri with either a `code` (approve) or `error=access_denied` (deny).
 *
 * The redirect_uri is intercepted so the assertion reads the exact callback URL
 * the server emits, independent of whatever that in-app route would do next.
 *
 * Runs in the `oauth` project (no stored auth state) and uses the shared seed
 * user — it only reads, so it never mutates the seed account.
 */

const REDIRECT_URI = 'http://localhost:5173/oauth/e2e-callback';
const APPROVE_STATE = 'oauth-e2e-approve-state';
const DENY_STATE = 'oauth-e2e-deny-state';

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

async function registerClient(request: APIRequestContext): Promise<string> {
  const res = await request.post('/oauth/register', {
    data: { client_name: 'E2E OAuth Client', redirect_uris: [REDIRECT_URI] },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { client_id: string };
  expect(body.client_id).toBeTruthy();
  return body.client_id;
}

function authorizeUrl(opts: { clientId: string; codeChallenge: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
    scope: 'kitchen:read',
    state: opts.state,
  });
  return `/oauth/authorize?${params}`;
}

/**
 * Stub the registered redirect_uri so the OAuth callback never triggers a real
 * navigation/load. Resolves with the exact callback URL once the server
 * redirects the browser there.
 */
function captureCallback(page: Page): Promise<URL> {
  return new Promise<URL>((resolve) => {
    void page.route(`${REDIRECT_URI}*`, async (route) => {
      const callbackUrl = new URL(route.request().url());
      await route.fulfill({ status: 200, contentType: 'text/html', body: 'ok' });
      resolve(callbackUrl);
    });
  });
}

test.describe('OAuth authorize + consent flow', () => {
  test('unauthenticated authorize gates to login, then consent grants a code', async ({ page }) => {
    const clientId = await registerClient(page.request);
    const verifier = randomVerifier();
    const challenge = await pkceChallenge(verifier);
    const authorize = authorizeUrl({ clientId, codeChallenge: challenge, state: APPROVE_STATE });

    // Unauthenticated: the authorize endpoint must redirect to /login, carrying
    // the authorize URL forward in redirectTo so we return after signing in.
    await page.goto(authorize);
    await expect(page).toHaveURL(/\/login\?redirectTo=/);
    expect(decodeURIComponent(page.url())).toContain('/oauth/authorize');

    // Log in as the seed user; the preserved redirectTo lands us on consent.
    await loginAsSeedUser(page, /\/oauth\/authorize\?/);

    await expect(page).toHaveURL(/\/oauth\/authorize/);
    await expect(page.getByRole('heading', { name: /authorize/i })).toBeVisible();
    await expect(page.getByText(/view public recipes, cookbooks, and your shopping list/i)).toBeVisible();
    const allow = page.getByRole('button', { name: /allow access/i });
    await expect(allow).toBeVisible();

    // Approve → redirected back to the registered redirect_uri with code + state.
    const callback = captureCallback(page);
    await allow.click();
    const result = await callback;
    expect(result.searchParams.get('code')).toBeTruthy();
    expect(result.searchParams.get('state')).toBe(APPROVE_STATE);
  });

  test('denying consent redirects back with access_denied', async ({ page }) => {
    const clientId = await registerClient(page.request);
    const verifier = randomVerifier();
    const challenge = await pkceChallenge(verifier);
    const authorize = authorizeUrl({ clientId, codeChallenge: challenge, state: DENY_STATE });

    await page.goto(authorize);
    await expect(page).toHaveURL(/\/login\?redirectTo=/);

    await loginAsSeedUser(page, /\/oauth\/authorize\?/);
    await expect(page).toHaveURL(/\/oauth\/authorize/);

    const deny = page.getByRole('button', { name: /^deny$/i });
    await expect(deny).toBeVisible();

    const callback = captureCallback(page);
    await deny.click();
    const result = await callback;
    expect(result.searchParams.get('error')).toBe('access_denied');
    expect(result.searchParams.get('state')).toBe(DENY_STATE);
  });
});
