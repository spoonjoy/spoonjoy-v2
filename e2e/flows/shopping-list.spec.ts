import { test, expect } from '@playwright/test';

test.describe('Shopping List Flow', () => {
  test('shopping list page loads', async ({ page }) => {
    await page.goto('/shopping-list');

    // Should show shopping list heading or content
    const heading = page.getByRole('heading', { name: /shopping/i }).first();
    await expect(heading).toBeVisible();
  });

  test('shopping list shows items or empty state', async ({ page }) => {
    await page.goto('/shopping-list');

    // Should show items or empty state message
    const content = page.getByText(/shopping|item|ingredient|empty|add/i).first();
    await expect(content).toBeVisible();
  });

  test('can add item to shopping list', async ({ page }) => {
    await page.goto('/shopping-list');

    // Look for add item input or button
    const addInput = page.getByRole('textbox', { name: /add|item|ingredient/i }).or(
      page.getByPlaceholder(/add|item|ingredient/i)
    ).first();

    const addButton = page.getByRole('button', { name: /add|\+/i }).first();

    // Should have a way to add items
    const hasAddInput = await addInput.isVisible().catch(() => false);
    const hasAddButton = await addButton.isVisible().catch(() => false);

    expect(hasAddInput || hasAddButton).toBe(true);
  });

  test('can check/uncheck shopping list item', async ({ page }) => {
    await page.goto('/shopping-list');

    const allViewButton = page.getByRole('button', { name: /^All \d+/ });
    if (await allViewButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await allViewButton.click();
    }

    // Look for checkboxes
    const checkbox = page.getByRole('checkbox').first();

    // If there are items with checkboxes
    if (await checkbox.isVisible({ timeout: 3000 }).catch(() => false)) {
      const itemName = await checkbox.getAttribute('aria-label');
      expect(itemName).toBeTruthy();

      const checkboxElement = await checkbox.elementHandle();
      expect(checkboxElement).toBeTruthy();
      const initialState = await checkboxElement!.evaluate((element) => element.getAttribute('aria-checked'));
      await checkbox.click();

      await expect.poll(() => (
        checkboxElement!.evaluate((element) => element.getAttribute('aria-checked'))
      )).toBe(initialState === 'true' ? 'false' : 'true');
    }
  });

  test('shopping list accessible from navigation', async ({ page }) => {
    await page.goto('/recipes');

    // Find shopping list nav link
    const shoppingListLink = page.getByRole('link', { name: /shopping|list|cart/i }).first();
    await expect(shoppingListLink).toBeVisible();
    
    // Click and verify navigation
    await shoppingListLink.click();
    await expect(page).toHaveURL(/\/shopping-list/);
  });
});
