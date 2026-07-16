import { test as setup } from '@playwright/test';
import {
  createDisposableE2EUser,
  DISPOSABLE_E2E_AUTH_STATE,
  recordDisposableE2EUser,
  secureDisposableE2EAuthFile,
} from './support/disposable-auth';

setup('authenticate', async ({ page }) => {
  const user = createDisposableE2EUser();

  await page.goto('/signup');
  await page.locator('input[name="email"]:visible').fill(user.email);
  await page.locator('input[name="username"]:visible').fill(user.username);
  await page.locator('input[name="password"]:visible').fill(user.password);
  await page.locator('input[name="confirmPassword"]:visible').fill(user.password);
  await page.getByRole('button', { name: /sign up/i }).first().click();

  // Wait for redirect away from /signup — signup redirects to /recipes by default,
  // but tests may follow up by navigating elsewhere.
  await page.waitForURL((url) => !url.pathname.startsWith('/signup'));

  recordDisposableE2EUser(user);

  // Save storage state
  await page.context().storageState({ path: DISPOSABLE_E2E_AUTH_STATE });
  secureDisposableE2EAuthFile(DISPOSABLE_E2E_AUTH_STATE);
});
