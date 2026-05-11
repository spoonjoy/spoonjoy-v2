import { test as setup, expect } from '@playwright/test';

const authFile = './e2e/.auth/user.json';

setup('authenticate', async ({ page }) => {
  // Go to login page
  await page.goto('/login');

  // Fill in credentials (demo user from seed data)
  // Use first() because responsive layouts duplicate form fields
  await page.getByLabel('Email').first().fill('demo@spoonjoy.com');
  await page.getByLabel('Password').first().fill('demo1234');

  // Click login button
  await page.getByRole('button', { name: /log in/i }).first().click();

  // Wait for redirect away from /login — login redirects to /recipes by default,
  // but tests may follow up by navigating elsewhere.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));

  // Save storage state
  await page.context().storageState({ path: authFile });
});
