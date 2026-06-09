import { test, expect, type Page } from '@playwright/test';
import { publicRecipeHrefByChef, publicRecipeLinks } from '../support/recipes';

function recipeDetailLinks(page: Page) {
  return publicRecipeLinks(page);
}

test.describe('Recipe Flow', () => {
  test('recipes page shows recipe cards', async ({ page }) => {
    await page.goto('/recipes');

    // /recipes is public browsing. This project runs authenticated, so the hero
    // no longer nags about signing in; the copy is auth-aware (see recipes._index).
    await expect(page.getByRole('heading', { name: /recipes worth opening/i })).toBeVisible();

    // Should show recipe rows/cards (links to recipe detail pages, excluding /recipes/new)
    const recipeLinks = recipeDetailLinks(page);
    await expect(recipeLinks.first()).toBeVisible();
  });

  test('clicking recipe card navigates to recipe detail', async ({ page }) => {
    await page.goto('/recipes');
    
    // Find a recipe card - should be a clickable link
    // Exclude /recipes/new (create button) - match any recipe UUID links
    const recipeLinks = recipeDetailLinks(page);
    const firstRecipeCard = recipeLinks.first();
    
    // CRITICAL: This will FAIL if recipe cards are not clickable
    await expect(firstRecipeCard).toBeVisible({ timeout: 5000 });
    
    // Click the recipe card
    await firstRecipeCard.click();
    
    // Should navigate to recipe detail page
    await expect(page).toHaveURL(/\/recipes\/(?!new$)[^/]+$/);
    
    // Recipe detail should show title
    const recipeTitle = page.getByRole('heading', { level: 1 }).or(
      page.getByRole('heading').first()
    );
    await expect(recipeTitle).toBeVisible();
  });

  test('recipe detail shows steps and ingredients', async ({ page }) => {
    // Use a seeded chef_julia recipe so this flow is not affected by parallel
    // e2e-created recipes appearing at the top of the global recipe index.
    const href = await publicRecipeHrefByChef(page, 'chef_julia');
    
    // Navigate to the recipe detail page
    await page.goto(href);
    
    // Wait for hydration to complete by waiting for an interactive element
    await page.waitForLoadState('domcontentloaded');
    
    // Should be on recipe detail page
    await expect(page).toHaveURL(/\/recipes\/(?!new$)[^/]+$/);
    
    // Should show recipe title (any heading on the page indicates we've loaded)
    const title = page.getByRole('heading').first();
    await expect(title).toBeVisible({ timeout: 15000 });
    
    await expect(page.getByRole('heading', { name: /^steps$/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/ingredients/i).first()).toBeVisible({ timeout: 10000 });
  });
});
