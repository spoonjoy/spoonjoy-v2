import { test as setup } from "./fixtures";
import {
  createDisposableE2EUser,
  recordDisposableE2EUser,
  writeDisposableE2EAuthState,
} from './support/disposable-auth';
import { fillSecret } from './journeys/support/secret-input';

setup('authenticate', async ({ page }) => {
  const user = createDisposableE2EUser();

  await page.goto('/signup');
  await page.locator('input[name="email"]:visible').fill(user.email);
  await page.locator('input[name="username"]:visible').fill(user.username);
  await fillSecret(page.locator('input[name="password"]:visible'), user.password);
  await fillSecret(page.locator('input[name="confirmPassword"]:visible'), user.password);
  await page.getByRole('button', { name: /sign up/i }).first().click();

  // Wait for redirect away from /signup — signup redirects to /recipes by default,
  // but tests may follow up by navigating elsewhere.
  await page.waitForURL((url) => !url.pathname.startsWith('/signup'));

  recordDisposableE2EUser(user);

  // Authenticated projects need only the session cookie. Keep setup-project
  // local and session storage from leaking into every dependent test context.
  writeDisposableE2EAuthState(await page.context().storageState());
});
