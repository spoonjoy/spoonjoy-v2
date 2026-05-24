import { test, expect } from '@playwright/test';

/**
 * D-013 regression: `/recipes/new` failed at runtime on Cloudflare D1 because
 * `createRecipeDraft` used `db.$transaction(async (tx) => ...)` — the Prisma
 * interactive form, which D1 does not support. Local Vitest passed because
 * those tests run against better-sqlite3, which supports both transaction
 * forms; the real D1 adapter does not.
 *
 * This e2e exercises the live form against the dev server (which uses the
 * Cloudflare D1 binding via `getPlatformProxy`), so it surfaces the runtime
 * failure that unit tests missed.
 */
test.describe('Create recipe flow', () => {
  test('demo user can create a minimal recipe from the new-recipe form', async ({ page }) => {
    // Visit the create-recipe page (auth comes from storageState).
    await page.goto('/recipes/new');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

    // Fill in the title — keep it unique so reruns don't trip the
    // active-recipe-title uniqueness validator.
    const uniqueTitle = `e2e create recipe ${Date.now()}`;
    const titleInput = page.getByRole('textbox', { name: 'Title' }).first();
    await expect(titleInput).toBeVisible();
    await titleInput.fill(uniqueTitle);

    // Add a step.
    const addStepButton = page.getByRole('button', { name: /add step/i }).first();
    await expect(addStepButton).toBeVisible();
    await addStepButton.click();

    // Fill in the step instructions.
    const instructions = page.getByLabel('Instructions').first();
    await expect(instructions).toBeVisible();
    await instructions.fill('Mix everything together and cook until done.');

    // Switch to manual ingredient entry. The IngredientInputToggle is a
    // headlessui Switch labelled "AI Parse"; clicking it flips to manual mode.
    const aiSwitch = page.getByRole('switch', { name: /AI Parse/i }).first();
    await expect(aiSwitch).toBeVisible();
    await aiSwitch.click();

    await page.getByLabel(/^quantity/i).first().fill('2');
    await page.getByLabel(/^unit/i).first().fill('cup');
    await page.getByLabel(/^ingredient$/i).first().fill('flour');
    await page.getByRole('button', { name: /^add ingredient$/i }).first().click();

    // Persist step state (StepEditorCard requires the per-step Save).
    await page.getByRole('button', { name: /^save$/i }).first().click();

    // Submit the recipe.
    await page.getByRole('button', { name: /create recipe/i }).click();

    // After successful POST the action redirects to /recipes/<newId>.
    // The bug manifests as a 500 + general error remaining on /recipes/new,
    // so we must explicitly exclude `new` and require an id-shaped segment.
    await expect(page).toHaveURL(
      /\/recipes\/(?!new$)[A-Za-z0-9_-]+$/,
      { timeout: 15_000 },
    );
    await expect(page.getByRole('heading', { name: uniqueTitle })).toBeVisible({ timeout: 10_000 });
  });

  test('demo user can reorder draft recipe steps by dragging the step handle', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 2400 });
    await page.goto('/recipes/new');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('textbox', { name: 'Title' }).first().fill(`e2e drag recipe ${Date.now()}`);

    const addStepButton = page.getByRole('button', { name: /add step/i }).first();
    const stepCopies = ['First drag step', 'Second drag step'];

    for (const [index, copy] of stepCopies.entries()) {
      await addStepButton.click();
      const stepCard = page.locator('article[aria-label^="Step"]').nth(index);
      await stepCard.getByLabel(/instructions/i).fill(copy);
      await stepCard.getByRole('button', { name: /^save$/i }).click();
    }

    await expect.poll(async () => {
      const boxes = await page.locator('article[aria-label^="Step"]').evaluateAll((articles) =>
        articles.map((article) => {
          const rect = article.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom };
        }),
      );
      return boxes.length === 2 && boxes[1].top >= boxes[0].bottom;
    }).toBe(true);

    const dragHandles = page.getByRole('button', { name: /drag to reorder/i });
    const source = await dragHandles.nth(1).boundingBox();
    const target = await dragHandles.nth(0).boundingBox();
    expect(source).not.toBeNull();
    expect(target).not.toBeNull();

    await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
    await page.mouse.down();
    await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 40 });
    await page.mouse.up();

    await expect
      .poll(async () => page.locator('article[aria-label^="Step"]').nth(0).getByLabel(/instructions/i).inputValue())
      .toBe('Second drag step');
    await expect(page.locator('article[aria-label^="Step"]').nth(1).getByLabel(/instructions/i)).toHaveValue('First drag step');
  });
});
