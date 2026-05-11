import { test, expect } from '@playwright/test';
import path from 'node:path';

const FIXTURE_PHOTO = path.resolve('e2e/fixtures/spoon-test-photo.png');

test.describe('Spoon a recipe flow', () => {
  test('user can log a cook and see it appear in the spoons strip', async ({ page }) => {
    // Land on the kitchen view; pick any seeded recipe owned by another chef
    // so the demo user lands on the non-origin-cook path (photo not required).
    await page.goto('/?tab=recipes&chef=chef_julia');
    const recipeLink = page
      .locator('main a[href^="/recipes/"]')
      .filter({ hasNotText: /new/i })
      .first();
    await expect(recipeLink).toBeVisible({ timeout: 10_000 });
    await recipeLink.click();
    await expect(page).toHaveURL(/\/recipes\/[^/]+$/, { timeout: 10_000 });

    // Open the spoon dialog.
    const logCookButton = page.getByRole('button', { name: /log a cook/i }).first();
    await expect(logCookButton).toBeVisible({ timeout: 5000 });
    await logCookButton.click();

    // Dialog headings are rendered as headings by the Dialog primitive.
    await expect(page.getByRole('heading', { name: /log a cook/i })).toBeVisible();

    // Demo viewer is not the recipe owner here, so a note alone satisfies
    // the form validation (no photo required for non-origin-cook spoons).
    const uniqueNote = `e2e spoon ${Date.now()}`;
    const noteLabel = page.getByLabel(/^note/i);
    await noteLabel.fill(uniqueNote);
    // Upload the fixture photo so the spoon strip also gets a thumbnail —
    // this exercises the photo-write path even when not strictly required.
    const photoInput = page.locator('input[type="file"]');
    await photoInput.setInputFiles(FIXTURE_PHOTO);

    const submit = page.getByRole('button', { name: /save spoon/i });
    await expect(submit).toBeEnabled();
    await submit.click();

    // The submission triggers a server action + reload; wait for the spoon to
    // surface in the strip. The dialog backdrop may briefly overlay the page,
    // so we assert the new spoon's note text rather than the section heading.
    await expect(page.getByText(uniqueNote)).toBeVisible({ timeout: 15_000 });
  });
});
