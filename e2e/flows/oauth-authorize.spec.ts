import { test, expect } from '@playwright/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { loginAsDisposableUser } from '../support/auth';

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
 * Runs in the `oauth` project (no stored auth state) and logs in with the
 * per-run disposable e2e user created by the setup project.
 */

const REDIRECT_URI = 'https://client.example/oauth/e2e-callback';
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

async function advertisedMcpResource(request: APIRequestContext): Promise<string> {
  const response = await request.get('/.well-known/oauth-protected-resource/mcp');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { resource?: unknown };
  expect(body.resource).toMatch(/^https?:\/\/.+\/mcp$/);
  return body.resource as string;
}

function authorizeUrl(opts: { clientId: string; codeChallenge: string; state: string; resource: string }): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
    scope: 'kitchen:read',
    state: opts.state,
    resource: opts.resource,
  });
  return `/oauth/authorize?${params}`;
}

async function exchangeCodeForTokens(
  request: APIRequestContext,
  input: { clientId: string; code: string; verifier: string },
): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await request.post('/oauth/token', {
    form: {
      grant_type: 'authorization_code',
      client_id: input.clientId,
      redirect_uri: REDIRECT_URI,
      code: input.code,
      code_verifier: input.verifier,
    },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    token_type: string;
    scope: string;
    expires_in?: number;
  };
  expect(body.token_type).toBe('Bearer');
  expect(body.scope).toBe('kitchen:read');
  expect(body.expires_in).toBeUndefined();
  expect(body.access_token).toMatch(/^sj_/);
  expect(body.refresh_token).toMatch(/^ort_/);
  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

async function refreshTokens(
  request: APIRequestContext,
  input: { clientId: string; refreshToken: string },
): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await request.post('/oauth/token', {
    form: {
      grant_type: 'refresh_token',
      client_id: input.clientId,
      refresh_token: input.refreshToken,
    },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { access_token: string; refresh_token: string; expires_in?: number };
  expect(body.expires_in).toBeUndefined();
  expect(body.access_token).toMatch(/^sj_/);
  expect(body.refresh_token).toMatch(/^ort_/);
  expect(body.refresh_token).not.toBe(input.refreshToken);
  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

async function expectRefreshReplayRejected(
  request: APIRequestContext,
  input: { clientId: string; refreshToken: string },
): Promise<void> {
  const res = await request.post('/oauth/token', {
    form: {
      grant_type: 'refresh_token',
      client_id: input.clientId,
      refresh_token: input.refreshToken,
    },
  });
  expect(res.status()).toBe(400);
  await expect(res.json()).resolves.toMatchObject({ error: 'invalid_grant' });
}

async function expectMcpReady(request: APIRequestContext, accessToken: string): Promise<void> {
  const initialize = await request.post('/mcp', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
  });
  expect(initialize.status()).toBe(200);
  await expect(initialize.json()).resolves.toMatchObject({
    result: { protocolVersion: '2025-06-18', serverInfo: { name: 'spoonjoy' } },
  });

  const tools = await request.post('/mcp', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  });
  expect(tools.status()).toBe(200);
  const body = (await tools.json()) as { result: { tools: { name: string }[] } };
  expect(body.result.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
    'search_spoonjoy',
    'get_shopping_list',
  ]));
}

async function expectConsentFitsDesktop(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    width: document.documentElement.scrollWidth,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
  }));
  expect(metrics.width).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.height).toBeLessThanOrEqual(metrics.viewportHeight + 4);
}

/**
 * Resolves with the exact outbound callback request. The host is deliberately
 * external and non-resolving: observing the request proves the consent
 * document's form-action CSP allowed it without making CI depend on DNS.
 */
async function submitAndReadCallback(page: Page, button: Locator): Promise<URL> {
  const callbackRequest = page.waitForRequest((request) => request.url().startsWith(REDIRECT_URI));
  const click = button.click().catch((error: unknown) => {
    if (!(error instanceof Error) || !error.message.includes('ERR_NAME_NOT_RESOLVED')) throw error;
  });
  const request = await callbackRequest;
  await click;
  return new URL(request.url());
}

async function expectNativeSubmitForm(button: Locator): Promise<void> {
  const form = button.locator('xpath=ancestor::form[1]');
  await expect(form).toHaveCount(1);
  await expect(form).toHaveAttribute('method', 'post');
  await expect(form).not.toHaveAttribute('data-discover', /.*/);
}

test.describe('OAuth authorize + consent flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://client.example/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>OAuth callback intercepted</title>',
      });
    });
  });

  test('unauthenticated authorize gates to login, then consent grants a code', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const clientId = await registerClient(page.request);
    const resource = await advertisedMcpResource(page.request);
    const verifier = randomVerifier();
    const challenge = await pkceChallenge(verifier);
    const authorize = authorizeUrl({ clientId, codeChallenge: challenge, state: APPROVE_STATE, resource });

    // Unauthenticated: the authorize endpoint must redirect to /login, carrying
    // the authorize URL forward in redirectTo so we return after signing in.
    await page.goto(authorize);
    await expect(page).toHaveURL(/\/login\?redirectTo=/);
    expect(decodeURIComponent(page.url())).toContain('/oauth/authorize');

    // Log in as the disposable e2e user; the preserved redirectTo lands us on consent.
    const consentDocument = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/oauth/authorize'
        && response.request().method() === 'GET'
        && response.headers()['content-type']?.includes('text/html') === true;
    });
    await loginAsDisposableUser(page, /\/oauth\/authorize\?/);
    const consentResponse = await consentDocument;
    expect(consentResponse.headers()['content-security-policy']).toContain(
      "form-action 'self' https://client.example",
    );

    await expect(page.getByRole('heading', { name: /connect e2e oauth client to spoonjoy/i })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/oauth/authorize');
    await expect(page.getByText(/read recipes, cookbooks, and your shopping list/i)).toBeVisible();
    await expect(page.getByText(/this connection stays active until you disconnect it/i)).toBeVisible();
    const allow = page.getByRole('button', { name: /allow access/i });
    await expect(allow).toBeVisible();
    await expectNativeSubmitForm(allow);
    await expectConsentFitsDesktop(page);

    // Approve → redirected back to the registered redirect_uri with code + state.
    const result = await submitAndReadCallback(page, allow);
    const code = result.searchParams.get('code');
    expect(code).toBeTruthy();
    expect(result.searchParams.get('state')).toBe(APPROVE_STATE);

    // The browser code is useful only if the token and MCP resource contract
    // also holds. This catches audience binding, durable MCP access-token
    // lifetime, refresh rotation, and the MCP initialize/tools-list shape.
    const first = await exchangeCodeForTokens(page.request, { clientId, code: code!, verifier });
    await expectMcpReady(page.request, first.accessToken);
    const rotated = await refreshTokens(page.request, { clientId, refreshToken: first.refreshToken });
    await expectRefreshReplayRejected(page.request, { clientId, refreshToken: first.refreshToken });
    await expectMcpReady(page.request, rotated.accessToken);
  });

  test('denying consent redirects back with access_denied', async ({ page }) => {
    const clientId = await registerClient(page.request);
    const resource = await advertisedMcpResource(page.request);
    const verifier = randomVerifier();
    const challenge = await pkceChallenge(verifier);
    const authorize = authorizeUrl({ clientId, codeChallenge: challenge, state: DENY_STATE, resource });

    await page.goto(authorize);
    await expect(page).toHaveURL(/\/login\?redirectTo=/);

    await loginAsDisposableUser(page, /\/oauth\/authorize\?/);

    const deny = page.getByRole('button', { name: /^deny$/i });
    await expect(deny).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/oauth/authorize');
    await expectNativeSubmitForm(deny);

    const result = await submitAndReadCallback(page, deny);
    expect(result.searchParams.get('error')).toBe('access_denied');
    expect(result.searchParams.get('state')).toBe(DENY_STATE);
  });
});
