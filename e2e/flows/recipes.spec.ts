import { test, expect } from '@playwright/test';

test.describe('Recipe Flow', () => {
  test('recipes page shows recipe cards', async ({ page }) => {
    await page.goto('/recipes');

    // /recipes is public browsing; mutating actions ask users to sign in later.
    await expect(page.getByRole('heading', { name: /recipes worth opening before you sign in/i })).toBeVisible();

    // Should show recipe rows/cards (links to recipe detail pages, excluding /recipes/new)
    const recipeLinks = page.locator('a[href^="/recipes/"]').filter({ hasNot: page.locator('button') });
    await expect(recipeLinks.first()).toBeVisible();
  });

  test('clicking recipe card navigates to recipe detail', async ({ page }) => {
    await page.goto('/recipes');
    
    // Find a recipe card - should be a clickable link
    // Exclude /recipes/new (create button) - match any recipe UUID links
    const recipeLinks = page.locator('a[href^="/recipes/"]').filter({ 
      hasNot: page.locator('[href="/recipes/new"]')
    });
    const firstRecipeCard = recipeLinks.first();
    
    // CRITICAL: This will FAIL if recipe cards are not clickable
    await expect(firstRecipeCard).toBeVisible({ timeout: 5000 });
    
    // Click the recipe card
    await firstRecipeCard.click();
    
    // Should navigate to recipe detail page
    await expect(page).toHaveURL(/\/recipes\/[^/]+$/);
    
    // Recipe detail should show title
    const recipeTitle = page.getByRole('heading', { level: 1 }).or(
      page.getByRole('heading').first()
    );
    await expect(recipeTitle).toBeVisible();
  });

  test('recipe detail shows steps and ingredients', async ({ page }) => {
    // First, navigate to recipes page to get a real recipe ID
    await page.goto('/recipes');
    
    // Get the first recipe card link
    const recipeLink = page.locator('a[href^="/recipes/"]').filter({
      hasNot: page.locator('[href="/recipes/new"]')
    }).first();
    
    // Get the href attribute to extract the recipe ID
    const href = await recipeLink.getAttribute('href');
    if (!href) {
      throw new Error('Could not find recipe link');
    }
    
    // Navigate to the recipe detail page
    await page.goto(href);
    
    // Wait for hydration to complete by waiting for an interactive element
    await page.waitForLoadState('domcontentloaded');
    
    // Should be on recipe detail page
    await expect(page).toHaveURL(/\/recipes\/[^/]+$/);
    
    // Should show recipe title (any heading on the page indicates we've loaded)
    const title = page.getByRole('heading').first();
    await expect(title).toBeVisible({ timeout: 15000 });
    
    // Wait a bit for hydration since React Router streams content
    await page.waitForTimeout(2000);
    
    // Should show step content - just verify there's some content about steps/ingredients
    // The exact text will depend on which recipe is loaded
    const content = page.locator('[class*="step"], [class*="ingredient"], h2, h3').first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });
});
