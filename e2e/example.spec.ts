import { test, expect } from "./fixtures";

test('homepage loads with Spoonjoy branding and Login button', async ({ page }) => {
  await page.goto('/');

  // Assert page has "Spoonjoy" in title or visible text
  const title = await page.title();
  const pageText = await page.textContent('body');
  const hasSpoonjoy = title.toLowerCase().includes('spoonjoy') ||
                      (pageText?.toLowerCase().includes('spoonjoy') ?? false);
  expect(hasSpoonjoy).toBe(true);

  // Assert Login button is visible (use first() since there are 2 in responsive layouts)
  const loginButton = page.getByRole('link', { name: /log\s*in/i }).first();
  await expect(loginButton).toBeVisible();
});
