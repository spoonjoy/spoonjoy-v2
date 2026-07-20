import { test, expect } from '@playwright/test';

/**
 * Full passkey lifecycle against a real (virtual) authenticator:
 *   sign up → enroll a named passkey → rename it → log out →
 *   sign in with the passkey → remove it.
 *
 * Uses Chrome DevTools Protocol's virtual authenticator so no physical
 * security key or biometric prompt is needed. Runs in the dedicated
 * `webauthn` project (no stored auth state) and signs up a unique user so it
 * never mutates the shared seed account other authed specs depend on.
 */
test.describe('Passkey lifecycle', () => {
  test('enroll, rename, sign in, and remove a passkey', async ({ page }) => {
    // Attach a virtual authenticator that auto-approves user presence +
    // verification, so register/authenticate ceremonies resolve without UI.
    const client = await page.context().newCDPSession(page);
    await client.send('WebAuthn.enable');
    await client.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const email = `e2e-passkey-${suffix}@example.com`;
    const username = `epk_${suffix}`.slice(0, 20);
    const password = 'passkey-e2e-pw-1234';

    // --- sign up a fresh user (lands logged in on /recipes) ---
    await page.goto('/signup');
    await page.getByLabel('Email').first().fill(email);
    await page.getByLabel('Username').first().fill(username);
    await page.getByLabel('Password', { exact: true }).first().fill(password);
    await page.getByLabel('Confirm Password').first().fill(password);
    await page.getByRole('button', { name: /sign up/i }).first().click();
    await expect(page).toHaveURL('/recipes');

    // --- enroll a named passkey from account settings ---
    await page.goto('/account/settings');
    const passkeys = page.getByTestId('passkeys-section');
    await passkeys.getByLabel(/name \(optional\)/i).fill('E2E Key');
    await passkeys.getByRole('button', { name: /add a passkey/i }).click();
    await expect(passkeys.getByText('E2E Key')).toBeVisible();

    // --- rename it (the success banner confirms the rename landed; the
    // renamed label is asserted after re-login below) ---
    await passkeys.getByRole('button', { name: /rename e2e key/i }).click();
    await passkeys.getByLabel(/passkey name/i).fill('Renamed Key');
    await passkeys.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByText(/passkey renamed successfully/i)).toBeVisible();

    // --- log out ---
    await page.getByRole('button', { name: /log\s*out/i }).first().click();
    await page.waitForURL((url) => !url.pathname.startsWith('/account'));

    // --- sign in with the passkey through an OAuth continuation. This must
    // replace the login document so the consent page receives its callback CSP.
    const redirectUri = 'https://client.example/oauth/passkey-e2e-callback';
    const registration = await page.request.post('/oauth/register', {
      data: { client_name: 'Passkey E2E OAuth Client', redirect_uris: [redirectUri] },
    });
    expect(registration.status()).toBe(201);
    const { client_id: clientId } = await registration.json() as { client_id: string };
    const authorizeParams = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      code_challenge: 'A'.repeat(43),
      code_challenge_method: 'S256',
      scope: 'kitchen:read',
      state: 'passkey-oauth-e2e-state',
      resource: 'https://spoonjoy.app/mcp',
    });
    await page.goto(`/oauth/authorize?${authorizeParams}`);
    await expect(page).toHaveURL(/\/login\?redirectTo=/);
    const loginEmail = page.getByLabel('Email').first();
    await expect(page.getByRole('button', { name: /sign in with a passkey/i }).first()).toBeVisible();
    await loginEmail.fill(email);
    await expect(loginEmail).toHaveValue(email);
    const consentDocument = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/oauth/authorize'
        && response.request().method() === 'GET'
        && response.headers()['content-type']?.includes('text/html') === true;
    });
    await page.getByRole('button', { name: /sign in with a passkey/i }).first().click();
    await expect(page.getByRole('heading', { name: /connect passkey e2e oauth client to spoonjoy/i })).toBeVisible();
    const consentResponse = await consentDocument;
    expect(consentResponse.headers()['content-security-policy']).toContain(
      "form-action 'self' https://client.example",
    );

    // settings is auth-gated; reaching it confirms the passkey signed us in.
    await page.goto('/account/settings');
    const passkeysAfter = page.getByTestId('passkeys-section');
    await expect(passkeysAfter.getByText('Renamed Key')).toBeVisible();

    // --- remove it ---
    await passkeysAfter.getByRole('button', { name: /remove renamed key/i }).click();
    await passkeysAfter.getByRole('button', { name: /confirm remove renamed key/i }).click();
    await expect(passkeysAfter.getByText('Renamed Key')).toHaveCount(0);
  });
});
