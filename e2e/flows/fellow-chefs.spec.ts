import { test, expect } from '@playwright/test';
import path from 'node:path';

const FIXTURE_PHOTO = path.resolve('e2e/fixtures/spoon-test-photo.png');

test.describe('Fellow chefs + Kitchen visitors flow', () => {
  test('demo_chef spoons a chef_julia recipe and both appear on the derived-graph pages', async ({ page }) => {
    // 1) demo_chef (logged in) spoons one of chef_julia's recipes —
    //    same shape as the existing spoon-a-recipe.spec.ts.
    await page.goto('/?tab=recipes&chef=chef_julia');
    const recipeLink = page
      .locator('main a[href^="/recipes/"]')
      .filter({ hasNotText: /new/i })
      .first();
    await expect(recipeLink).toBeVisible({ timeout: 10_000 });
    await recipeLink.click();
    await expect(page).toHaveURL(/\/recipes\/[^/]+$/, { timeout: 10_000 });

    const logCookButton = page.getByRole('button', { name: /log a cook/i }).first();
    await expect(logCookButton).toBeVisible({ timeout: 5_000 });
    await logCookButton.click();
    await expect(page.getByRole('heading', { name: /log a cook/i })).toBeVisible();

    const note = `e2e fellow-chefs spoon ${Date.now()}`;
    await page.getByLabel(/^note/i).fill(note);
    await page.locator('input[type="file"]').setInputFiles(FIXTURE_PHOTO);
    const submit = page.getByRole('button', { name: /save spoon/i });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByText(note)).toBeVisible({ timeout: 15_000 });

    // 2) Visit demo_chef's Fellow chefs page — chef_julia should appear.
    await page.goto('/users/demo_chef/fellow-chefs');
    await expect(page.getByRole('heading', { name: /fellow chefs/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole('link', { name: /chef_julia/i }).first(),
    ).toHaveAttribute('href', '/users/chef_julia');

    // 3) Visit chef_julia's Kitchen visitors page — demo_chef should appear.
    await page.goto('/users/chef_julia/kitchen-visitors');
    await expect(
      page.getByRole('heading', { name: /kitchen visitors/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole('link', { name: /demo_chef/i }).first(),
    ).toHaveAttribute('href', '/users/demo_chef');
  });

  test('profile page exposes Fellow chefs and Kitchen visitors entry links', async ({ page }) => {
    await page.goto('/users/demo_chef');
    await expect(page.getByRole('heading', { name: 'demo_chef' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole('link', { name: /fellow chefs/i }),
    ).toHaveAttribute('href', '/users/demo_chef/fellow-chefs');
    await expect(
      page.getByRole('link', { name: /kitchen visitors/i }),
    ).toHaveAttribute('href', '/users/demo_chef/kitchen-visitors');
  });
});
