import { test, expect } from '@playwright/test';
import path from 'node:path';

const FIXTURE_PHOTO = path.resolve('e2e/fixtures/spoon-test-photo.png');

test.describe('Spoon a recipe flow', () => {
  test('user can log a cook and see it appear in the spoons strip', async ({ page }) => {
    await page.goto('/recipes');

    const recipeLinks = page.locator('a[href^="/recipes/"]').filter({
      hasNot: page.locator('[href="/recipes/new"]'),
    });
    await expect(recipeLinks.first()).toBeVisible({ timeout: 5000 });
    await recipeLinks.first().click();
    await expect(page).toHaveURL(/\/recipes\/[^/]+$/);

    // Open the spoon dialog.
    const logCookButton = page.getByRole('button', { name: /log a cook/i }).first();
    await expect(logCookButton).toBeVisible({ timeout: 5000 });
    await logCookButton.click();

    // Dialog headings are rendered as headings by the Dialog primitive.
    await expect(page.getByRole('heading', { name: /log a cook/i })).toBeVisible();

    // Add a note + upload a photo so the form validates regardless of
    // origin-cook gating (the demo recipes are owned by the seeded chef so
    // we cannot guarantee the viewer is the origin cook).
    const noteLabel = page.getByLabel(/^note/i);
    await noteLabel.fill(`e2e spoon ${Date.now()}`);
    const photoInput = page.locator('input[type="file"]');
    await photoInput.setInputFiles(FIXTURE_PHOTO);

    const submit = page.getByRole('button', { name: /save spoon/i });
    await expect(submit).toBeEnabled();
    await submit.click();

    // After submit, the dialog closes and the new spoon shows in the strip.
    await expect(page.getByRole('heading', { name: /^cooks$/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/just now|min ago/i).first()).toBeVisible({ timeout: 10_000 });
  });
});
