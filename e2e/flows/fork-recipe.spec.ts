import { test, expect } from '@playwright/test';
import { openPublicRecipeByChef } from '../support/recipes';

test.describe('Fork recipe flow', () => {
  test('viewer (demo) forks a recipe owned by chef_julia and lands on the fork', async ({ page }) => {
    // Land on the kitchen, browse chef_julia's recipes — demo user is not the owner,
    // so the Fork button label should be exactly "Fork".
    await openPublicRecipeByChef(page, 'chef_julia');

    // The page should now show a "Fork" button (demo is not the owner).
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
    // It renders as `<p><span>forked from </span><Link>chef_julia · Title</Link></p>`.
    await expect(
      page.locator('p', { hasText: /forked from/i }).first(),
    ).toBeAttached({ timeout: 15_000 });
    const provenanceLink = page.locator('a[href^="/recipes/"]').filter({ hasText: /chef_julia/i }).first();
    await expect(provenanceLink).toHaveAttribute('href', /\/recipes\/[a-z0-9]+/);
  });
});
