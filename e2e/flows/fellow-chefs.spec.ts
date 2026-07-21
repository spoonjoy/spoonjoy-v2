import { test, expect, type Page } from '@playwright/test';
import { createDisposableE2EUser, readLatestDisposableE2EUser } from '../support/disposable-auth';
import { currentRecipeOwnerUsername, openPublicRecipeByTitle } from '../support/recipes';

async function expectProfileLinkEventually(
  page: Page,
  path: string,
  username: string,
) {
  const headingName = path.endsWith('/fellow-chefs') ? /fellow chefs/i : /kitchen visitors/i;
  await expect.poll(async () => {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: headingName })).toBeVisible({ timeout: 10_000 });
    return page
      .getByRole('link', { name: new RegExp(username, 'i') })
      .first()
      .getAttribute('href')
      .catch(() => null);
  }, {
    message: `expected ${username} to appear on ${path}`,
    timeout: 20_000,
  }).toBe(`/users/${username}`);
}

test.describe('Fellow chefs + Kitchen visitors flow', () => {
  test.setTimeout(90_000);

  test('disposable user forks a public recipe and both chefs appear on derived-graph pages', async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: 'http://localhost:5173',
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    const user = createDisposableE2EUser();
    await page.goto('/signup');
    await page.locator('input[name="email"]:visible').fill(user.email);
    await page.locator('input[name="username"]:visible').fill(user.username);
    await page.locator('input[name="password"]:visible').fill(user.password);
    await page.locator('input[name="confirmPassword"]:visible').fill(user.password);
    await page.getByRole('button', { name: /sign up/i }).first().click();
    await page.waitForURL((url) => !url.pathname.startsWith('/signup'));

    // 1) The disposable logged-in user forks a seeded public recipe they do not own.
    const viewerUsername = user.username;
    await openPublicRecipeByTitle(page, 'Chicken Stir-Fry with Vegetables');
    const ownerUsername = await currentRecipeOwnerUsername(page);
    expect(ownerUsername).not.toBe(viewerUsername);

    const forkButton = page.getByTestId('recipe-header-fork-action');
    await expect(forkButton).toBeVisible({ timeout: 10_000 });
    await expect(forkButton).toBeEnabled();
    await forkButton.scrollIntoViewIfNeeded();
    const dialogForkSubmit = page
      .locator('form[action$="/fork"] button[type="submit"]')
      .first();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await forkButton.click();
      if (await dialogForkSubmit.isVisible({ timeout: 1_000 }).catch(() => false)) {
        break;
      }
    }
    await expect(dialogForkSubmit).toBeVisible({ timeout: 5_000 });
    await dialogForkSubmit.click();
    await expect(page).toHaveURL(/\/recipes\/[^/]+$/, { timeout: 15_000 });
    await expect(page.locator('p', { hasText: /forked from/i }).first()).toBeAttached({ timeout: 15_000 });

    // 2) Visit the disposable user's Fellow chefs page — the recipe owner should appear.
    await expectProfileLinkEventually(page, `/users/${viewerUsername}/fellow-chefs`, ownerUsername);

    // 3) Visit the owner's Kitchen visitors page — the disposable user should appear.
    await expectProfileLinkEventually(page, `/users/${ownerUsername}/kitchen-visitors`, viewerUsername);

    await context.close();
  });

  test('profile page exposes Fellow chefs and Kitchen visitors entry links', async ({ page }) => {
    const viewerUsername = readLatestDisposableE2EUser().username;

    await page.goto(`/users/${viewerUsername}`);
    await expect(page.getByRole('heading', { name: viewerUsername })).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole('link', { name: /fellow chefs/i }),
    ).toHaveAttribute('href', `/users/${viewerUsername}/fellow-chefs`);
    await expect(
      page.getByRole('link', { name: /kitchen visitors/i }),
    ).toHaveAttribute('href', `/users/${viewerUsername}/kitchen-visitors`);
  });
});
