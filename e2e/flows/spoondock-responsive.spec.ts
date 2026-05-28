import { expect, test, type Page } from '@playwright/test';

/**
 * SpoonDock responsive audit: every dock variant must fit — without
 * horizontal overflow and with >=44px touch targets — down to the
 * narrowest phones (iPhone 5/SE = 320px, iPhone 13 mini = 375px).
 *
 * Runs in the authenticated `chromium` project. Each width is a separate
 * describe so `test.use({ viewport })` applies.
 */

const NARROW_WIDTHS = [320, 375, 390] as const;

// Routes whose dock config differs. `/recipes/:id` (detail) is resolved at
// runtime; everything else is a static root/context config.
const STATIC_ROUTES: { path: string; label: string }[] = [
  { path: '/', label: 'kitchen (default)' },
  { path: '/search', label: 'search' },
  { path: '/shopping-list', label: 'shopping list' },
  { path: '/account/settings', label: 'account' },
  { path: '/cookbooks', label: 'cookbooks' },
  { path: '/users/demo_chef', label: 'users/profile' },
];

async function getDock(page: Page) {
  const dock = page.getByRole('navigation', { name: 'Spoonjoy navigation' });
  await expect(dock).toBeVisible();
  return dock;
}

async function assertDockFits(page: Page, label: string, viewportWidth: number) {
  const dock = await getDock(page);

  // 1. The dock must not overflow its own content box (grid columns fit).
  const metrics = await dock.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(
    metrics.scrollWidth,
    `${label}: dock content overflows its container (scrollWidth ${metrics.scrollWidth} > clientWidth ${metrics.clientWidth})`,
  ).toBeLessThanOrEqual(metrics.clientWidth + 1);

  // 2. The dock box must stay within the viewport.
  const box = await dock.boundingBox();
  expect(box, `${label}: dock should have a box`).not.toBeNull();
  expect(box!.x, `${label}: dock left edge off-screen`).toBeGreaterThanOrEqual(-1);
  expect(
    box!.x + box!.width,
    `${label}: dock right edge past viewport (${box!.x + box!.width} > ${viewportWidth})`,
  ).toBeLessThanOrEqual(viewportWidth + 1);

  // 3. Every interactive dock item is a >=44px touch target and stays inside the dock.
  const items = dock.locator('a, button');
  const count = await items.count();
  expect(count, `${label}: dock should have items`).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const itemBox = await items.nth(i).boundingBox();
    expect(itemBox, `${label}: item ${i} should have a box`).not.toBeNull();
    expect(itemBox!.height, `${label}: item ${i} touch height`).toBeGreaterThanOrEqual(44);
    expect(itemBox!.width, `${label}: item ${i} touch width`).toBeGreaterThanOrEqual(44);
    expect(
      itemBox!.x + itemBox!.width,
      `${label}: item ${i} spills past dock right edge`,
    ).toBeLessThanOrEqual(box!.x + box!.width + 1);
  }
}

for (const width of NARROW_WIDTHS) {
  test.describe(`SpoonDock @ ${width}px`, () => {
    test.use({ viewport: { width, height: 780 }, isMobile: true, hasTouch: true });

    for (const route of STATIC_ROUTES) {
      test(`${route.label} dock fits`, async ({ page }) => {
        await page.goto(route.path);
        await page.waitForLoadState('domcontentloaded');
        await assertDockFits(page, `${route.label} @ ${width}px`, width);
      });
    }

    test('recipe detail dock fits (worst case: place + primary + 3 tools)', async ({ page }) => {
      await page.goto('/recipes');
      await page.waitForLoadState('domcontentloaded');
      const href = await page.locator('a[href^="/recipes/"]').evaluateAll((links) =>
        links
          .map((link) => link.getAttribute('href'))
          .find((c) => !!c && c !== '/recipes/new' && /^\/recipes\/[^/]+$/.test(c)),
      );
      expect(href, 'expected a seeded recipe').toBeTruthy();
      await page.goto(href!);
      await page.waitForLoadState('domcontentloaded');
      await assertDockFits(page, `recipe detail @ ${width}px`, width);
    });
  });
}
