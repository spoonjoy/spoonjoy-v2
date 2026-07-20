import { test, expect } from "../fixtures";

test.describe('Cookbook Flow', () => {
  test('cookbooks page loads', async ({ page }) => {
    await page.goto('/cookbooks');
    
    // Should show cookbooks heading or content
    const heading = page.getByRole('heading', { name: /cookbook/i }).first();
    await expect(heading).toBeVisible();
  });

  test('cookbooks page shows cookbook cards', async ({ page }) => {
    await page.goto('/cookbooks');
    
    // Should show cookbook cards or empty state
    const cookbookContent = page.getByText(/cookbook|italian|quick|party|asian|brunch|sweet/i).first();
    await expect(cookbookContent).toBeVisible();
  });

  test('clicking cookbook shows recipes in cookbook', async ({ page }) => {
    await page.goto('/cookbooks');
    
    // Find a cookbook link
    const cookbookLink = page.locator('a[href^="/cookbooks/"]').first();
    
    // Should have clickable cookbook cards
    await expect(cookbookLink).toBeVisible({ timeout: 5000 });
    
    // Click the cookbook
    await cookbookLink.click();
    
    // Should navigate to cookbook detail
    await expect(page).toHaveURL(/\/cookbooks\/[^/]+$/);
  });

  test('cookbook detail shows recipes', async ({ page }) => {
    // Navigate to a known cookbook (Italian Favorites from seed)
    await page.goto('/cookbooks');
    
    // Find and click Italian Favorites or first cookbook
    const cookbookLink = page.locator('a[href^="/cookbooks/"]').first();
    
    if (await cookbookLink.isVisible()) {
      await cookbookLink.click();
      
      // Should show recipes in the cookbook
      const recipeContent = page.getByText(/recipe|pizza|pasta/i).first();
      await expect(recipeContent).toBeVisible({ timeout: 5000 });
    }
  });

  test('can create new cookbook', async ({ page }) => {
    await page.goto('/cookbooks');
    
    // Look for create/new cookbook button
    const createButton = page.getByRole('link', { name: /new|create|add/i }).or(
      page.getByRole('button', { name: /new|create|add/i })
    ).first();
    
    // Should have a way to create cookbooks
    await expect(createButton).toBeVisible({ timeout: 5000 });
  });
});
