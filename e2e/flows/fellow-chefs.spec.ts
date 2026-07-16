import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { readLatestDisposableE2EUser } from '../support/disposable-auth';
import { currentRecipeOwnerUsername, openPublicRecipe } from '../support/recipes';

const FIXTURE_PHOTO = path.resolve('e2e/fixtures/spoon-test-photo.png');

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
  test('disposable user spoons a public recipe and both chefs appear on derived-graph pages', async ({ page }) => {
    // 1) The disposable logged-in user spoons a seeded public recipe they do not own.
    await openPublicRecipe(page);
    const ownerUsername = await currentRecipeOwnerUsername(page);
    const viewerUsername = readLatestDisposableE2EUser().username;

    const logCookButton = page.getByTestId('recipe-header-log-cook-action');
    await expect(logCookButton).toBeVisible({ timeout: 5_000 });
    await expect(logCookButton).toBeEnabled();
    await logCookButton.scrollIntoViewIfNeeded();
    const dialogHeading = page.getByRole('heading', { name: /log a cook/i });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await logCookButton.click();
      if (await dialogHeading.isVisible({ timeout: 1_000 }).catch(() => false)) {
        break;
      }
    }
    if (!(await dialogHeading.isVisible({ timeout: 500 }).catch(() => false))) {
      const firstCookButton = page.getByRole('button', { name: /log the first cook/i });
      if (await firstCookButton.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await firstCookButton.scrollIntoViewIfNeeded();
        await firstCookButton.click();
      }
    }
    await expect(dialogHeading).toBeVisible();

    const noteField = page.getByLabel(/^note/i);
    await expect(noteField).toBeVisible({ timeout: 5_000 });

    const note = `e2e fellow-chefs spoon ${Date.now()}`;
    await noteField.fill(note);
    await page.locator('input[type="file"]').setInputFiles(FIXTURE_PHOTO);
    const submit = page.getByRole('button', { name: /save spoon/i });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByText(note)).toBeVisible({ timeout: 15_000 });

    // 2) Visit the disposable user's Fellow chefs page — the recipe owner should appear.
    await expectProfileLinkEventually(page, `/users/${viewerUsername}/fellow-chefs`, ownerUsername);

    // 3) Visit the owner's Kitchen visitors page — the disposable user should appear.
    await expectProfileLinkEventually(page, `/users/${ownerUsername}/kitchen-visitors`, viewerUsername);
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
