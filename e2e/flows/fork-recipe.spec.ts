import { test, expect } from "../fixtures";
import { readLatestDisposableE2EUser } from '../support/disposable-auth';
import { currentRecipeOwnerUsername, openPublicRecipeByTitle } from '../support/recipes';

test.describe('Fork recipe flow', () => {
  test('disposable viewer forks a public recipe and lands on the fork', async ({ page }) => {
    // Land on a seeded public recipe owned by someone other than the disposable viewer.
    const viewerUsername = readLatestDisposableE2EUser().username;
    await openPublicRecipeByTitle(page, 'Fresh Guacamole');
    const ownerUsername = await currentRecipeOwnerUsername(page);
    expect(ownerUsername).not.toBe(viewerUsername);

    // The page should now show a "Fork" button.
    const forkButton = page.getByTestId('recipe-header-fork-action');
    await expect(forkButton).toBeVisible({ timeout: 10_000 });
    await expect(forkButton).toBeEnabled();
    await forkButton.scrollIntoViewIfNeeded();

    // The confirmation dialog opens. The submit-form Fork button is in the dialog
    // alongside Cancel. Submit by clicking the second Fork button (the form one).
    // The dialog uses `<Form action="/recipes/<id>/fork" method="post">` which
    // submits and the action redirects to /recipes/<newId>.
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

    // After redirect, URL must still match /recipes/<id>$ but the id is different.
    await expect(page).toHaveURL(/\/recipes\/[^/]+$/, { timeout: 15_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    // The provenance line "forked from <chef-username>" should now be visible.
    await expect(
      page.locator('p', { hasText: /forked from/i }).first(),
    ).toBeAttached({ timeout: 15_000 });
    const provenanceLink = page.locator('a[href^="/recipes/"]').filter({ hasText: new RegExp(ownerUsername, 'i') }).first();
    await expect(provenanceLink).toHaveAttribute('href', /\/recipes\/[a-z0-9]+/);
  });
});
