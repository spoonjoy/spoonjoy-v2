import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
test.describe.configure({ mode: 'serial' });

async function getDock(page: Page) {
  const dock = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(dock).toBeVisible();
  return dock;
}

async function getFirstRecipeHref(page: Page) {
  await page.goto('/recipes');
  await page.waitForLoadState('domcontentloaded');

  const href = await page.locator('a[href^="/recipes/"]').evaluateAll((links) => {
    return links
      .map((link) => link.getAttribute('href'))
      .find((candidate) => (
        !!candidate &&
        candidate !== '/recipes/new' &&
        /^\/recipes\/[^/]+$/.test(candidate)
      ));
  });

  expect(href, 'expected at least one seeded recipe link').toBeTruthy();
  return href!;
}

async function expectTouchTarget(locator: Locator, label: string) {
  await expect(locator, `${label} should be visible`).toBeVisible();

  const explicitTouchTarget = locator.locator('[data-slot="touch-target"]').first();
  const box = await (await explicitTouchTarget.count() > 0
    ? explicitTouchTarget.boundingBox()
    : locator.boundingBox());

  expect(box, `${label} should have a measurable touch target`).not.toBeNull();
  expect(box!.width, `${label} touch target width`).toBeGreaterThanOrEqual(44);
  expect(box!.height, `${label} touch target height`).toBeGreaterThanOrEqual(44);
}

async function expectWithinDock(locator: Locator, dock: Locator, label: string) {
  const [box, dockBox] = await Promise.all([locator.boundingBox(), dock.boundingBox()]);

  expect(box, `${label} should have a bounding box`).not.toBeNull();
  expect(dockBox, 'dock should have a bounding box').not.toBeNull();
  expect(box!.x, `${label} should not overflow the dock left edge`).toBeGreaterThanOrEqual(dockBox!.x - 1);
  expect(
    box!.x + box!.width,
    `${label} should not overflow the dock right edge`,
  ).toBeLessThanOrEqual(dockBox!.x + dockBox!.width + 1);
}

async function expectAboveDock(locator: Locator, dock: Locator, label: string) {
  await locator.scrollIntoViewIfNeeded();

  const [box, dockBox] = await Promise.all([locator.boundingBox(), dock.boundingBox()]);

  expect(box, `${label} should have a bounding box`).not.toBeNull();
  expect(dockBox, 'dock should have a bounding box').not.toBeNull();
  expect(
    box!.y + box!.height,
    `${label} should remain above the fixed SpoonDock`,
  ).toBeLessThanOrEqual(dockBox!.y);
}

test.describe('Mobile RecipeBuilder and SpoonDock audit', () => {
  test('create flow keeps RecipeBuilder controls reachable above the dock', async ({ page }) => {
    await page.goto('/recipes/new');

    await expect(page.getByRole('heading', { name: 'Write the version future-you can actually cook.' })).toBeVisible();
    const dock = await getDock(page);

    await expectTouchTarget(dock.getByRole('link', { name: 'New' }), 'New dock link');
    await expectTouchTarget(dock.getByRole('link', { name: 'Go to Kitchen' }), 'Kitchen dock link');
    await expectTouchTarget(dock.getByRole('link', { name: 'List' }), 'List dock link');

    await page.getByLabel(/^Title$/).last().fill(`Mobile Audit ${Date.now()}`);
    await page.getByRole('button', { name: 'Add Step' }).click();
    await page.getByRole('textbox', { name: 'Instructions' }).fill('Stir until glossy.');

    await expectTouchTarget(page.getByRole('button', { name: 'Save' }).first(), 'step Save button');
    await expectTouchTarget(page.getByRole('button', { name: 'Remove' }).first(), 'step Remove button');
    await expectTouchTarget(page.getByRole('button', { name: 'Create Recipe' }), 'Create Recipe button');
    await expectAboveDock(page.getByRole('button', { name: 'Create Recipe' }), dock, 'Create Recipe button');
  });

  test('edit flow exposes working contextual Cancel and Save dock actions', async ({ page }) => {
    const recipeHref = await getFirstRecipeHref(page);
    await page.goto(`${recipeHref}/edit`);

    await expect(page.getByRole('heading', { name: 'Tune the recipe until it feels cookable.' })).toBeVisible();
    const dock = await getDock(page);
    const cancelAction = dock.getByRole('link', { name: 'Cancel' });
    const saveAction = dock.getByRole('button', { name: 'Save' });

    await expectTouchTarget(cancelAction, 'edit dock Cancel action');
    await expectTouchTarget(saveAction, 'edit dock Save action');
    await expectWithinDock(cancelAction, dock, 'edit dock Cancel action');
    await expectWithinDock(saveAction, dock, 'edit dock Save action');

    const updatedTitle = `Mobile Dock Save ${Date.now()}`;
    await page.getByLabel(/^Title$/).last().fill(updatedTitle);
    await saveAction.click();

    await expect(page).toHaveURL(new RegExp(`${recipeHref}$`));
    await expect(page.getByRole('heading', { name: updatedTitle })).toBeVisible();
  });

  test('recipe detail contextual dock actions fit and keep the save sheet usable', async ({ page }) => {
    const recipeHref = await getFirstRecipeHref(page);
    await page.goto(recipeHref);

    await expect(page.getByRole('heading').first()).toBeVisible();
    const dock = await getDock(page);
    const actions = [
      dock.getByRole('link', { name: 'Edit' }),
      dock.getByRole('button', { name: 'List' }),
      dock.getByRole('button', { name: 'Save' }),
      dock.getByRole('button', { name: 'Share' }),
    ];

    for (const [index, action] of actions.entries()) {
      await expectTouchTarget(action, `recipe detail dock action ${index + 1}`);
      await expectWithinDock(action, dock, `recipe detail dock action ${index + 1}`);
    }

    await dock.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Save to Cookbook' })).toBeVisible();
    await expectAboveDock(page.getByTestId('create-cookbook-button'), dock, 'save sheet Create & Save button');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Save to Cookbook' })).toBeHidden();
  });

  test('shopping-list mobile controls have touch targets and dock clearance', async ({ page }) => {
    await page.goto('/shopping-list');

    await expect(page.getByRole('heading', { name: 'Shopping List' })).toBeVisible();
    const dock = await getDock(page);

    await expectTouchTarget(dock.getByRole('link', { name: 'New' }), 'shopping dock New link');
    await expectTouchTarget(dock.getByRole('link', { name: 'List' }), 'shopping dock List link');
    const addButton = page.getByRole('button', { name: /^Add$/ });
    await expectTouchTarget(addButton, 'shopping Add button');
    await expectAboveDock(addButton, dock, 'shopping Add button');

    const checkButton = page.getByRole('button', { name: /^(Check|Uncheck) item$/ }).first();
    if (await checkButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expectTouchTarget(checkButton, 'shopping item check button');
    }
  });
});
