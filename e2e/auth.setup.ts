import { test as setup } from '@playwright/test';
import { loginAsSeedUser } from './support/auth';

const authFile = './e2e/.auth/user.json';

setup('authenticate', async ({ page }) => {
  // Go to login page
  await page.goto('/login');

  await loginAsSeedUser(page);

  // Wait for redirect away from /login — login redirects to /recipes by default,
  // but tests may follow up by navigating elsewhere.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));

  // Save storage state
  await page.context().storageState({ path: authFile });
});
