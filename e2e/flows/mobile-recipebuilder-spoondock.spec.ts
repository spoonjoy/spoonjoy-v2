import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
test.describe.configure({ mode: 'serial' });

async function getDock(page: Page) {
  const dock = page.getByRole('navigation', { name: 'Spoonjoy navigation' });
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

async function getFirstOwnedRecipeHref(page: Page) {
  await page.goto('/');
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

  expect(href, 'expected at least one owned seeded recipe link').toBeTruthy();
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
  test('create flow keeps RecipeBuilder controls reachable without the fixed dock', async ({ page }) => {
    await page.goto('/recipes/new');

    await expect(page.getByRole('heading', { name: 'Write the version future-you can actually cook.' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Spoonjoy navigation' })).toHaveCount(0);

    await page.getByLabel(/^Title$/).last().fill(`Mobile Audit ${Date.now()}`);
    const addStepButton = page.getByRole('button', { name: 'Add Step' });
    const instructions = page.getByRole('textbox', { name: 'Instructions' });
    await expect(addStepButton).toBeVisible();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await addStepButton.click();
      if (await instructions.isVisible({ timeout: 1_000 }).catch(() => false)) {
        break;
      }
    }
    await expect(instructions).toBeVisible();
    await instructions.fill('Stir until glossy.');

    await expectTouchTarget(page.getByRole('button', { name: 'Save' }).first(), 'step Save button');
    await expectTouchTarget(page.getByRole('button', { name: 'Remove' }).first(), 'step Remove button');
    await page.getByRole('button', { name: 'Create Recipe' }).scrollIntoViewIfNeeded();
    await expectTouchTarget(page.getByRole('button', { name: 'Create Recipe' }), 'Create Recipe button');
  });

  test('edit flow keeps save controls usable without the fixed dock', async ({ page }) => {
    const recipeHref = await getFirstOwnedRecipeHref(page);
    await page.goto(`${recipeHref}/edit`);

    await expect(page.getByRole('heading', { name: 'Edit Recipe' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Spoonjoy navigation' })).toHaveCount(0);

    const updatedTitle = `Mobile Dock Save ${Date.now()}`;
    await page.getByLabel(/^Title$/).last().fill(updatedTitle);
    const saveAction = page.getByRole('button', { name: 'Save Recipe' });
    await saveAction.scrollIntoViewIfNeeded();
    await expectTouchTarget(saveAction, 'edit Save Recipe button');
    await saveAction.click();

    await expect(page).toHaveURL(new RegExp(`${recipeHref}$`));
    await expect(page.getByRole('heading', { name: updatedTitle })).toBeVisible();
  });

  test('recipe detail masthead actions fit with the fixed dock', async ({ page }) => {
    const recipeHref = await getFirstRecipeHref(page);
    await page.goto(recipeHref);

    await expect(page.getByRole('heading').first()).toBeVisible();
    const dock = await getDock(page);

    const masthead = page.getByTestId('recipe-masthead');
    const cookModeAction = page.getByTestId('recipe-header-cook-action');
    const actions = [
      masthead.getByRole('link', { name: 'Recipes' }),
      cookModeAction,
      page.getByTestId('recipe-header-list-action'),
      page.getByTestId('recipe-header-log-cook-action'),
    ];

    for (const [index, action] of actions.entries()) {
      await expectTouchTarget(action, `recipe detail masthead action ${index + 1}`);
      await expectAboveDock(action, dock, `recipe detail masthead action ${index + 1}`);
    }

    await cookModeAction.click();
    await expect(page).toHaveURL(/#cook$/);
    await expect(page.getByRole('region', { name: /.+/ }).filter({ hasText: /Now cooking/i })).toBeVisible();
    await page.waitForFunction(() => {
      const target = [...document.querySelectorAll<HTMLElement>('#cook')].find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (!target) return false;

      const rect = target.getBoundingClientRect();
      return rect.top < window.innerHeight && rect.bottom > 0;
    });
  });

  test('shopping-list mobile controls have touch targets and dock clearance', async ({ page }) => {
    await page.goto('/shopping-list');

    await expect(page.getByRole('heading', { name: 'Shopping List' })).toBeVisible();
    const dock = await getDock(page);

    await expectTouchTarget(dock.getByRole('link', { name: /List market/i }), 'shopping dock List link');
    await expectTouchTarget(dock.getByRole('link', { name: 'Add' }), 'shopping dock Add link');
    await expectTouchTarget(dock.getByRole('link', { name: 'Search' }), 'shopping dock Search link');
    const addButton = page.getByRole('button', { name: /^Add$/ });
    await expectTouchTarget(addButton, 'shopping Add button');
    await expectAboveDock(addButton, dock, 'shopping Add button');

    const checkButton = page.getByRole('button', { name: /^(Check|Uncheck) item$/ }).first();
    if (await checkButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expectTouchTarget(checkButton, 'shopping item check button');
    }
  });
});
