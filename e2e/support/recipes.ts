import { expect, type Page } from '@playwright/test';

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function publicRecipeLinks(page: Page) {
  return page.locator('main a[href^="/recipes/"]:not([href="/recipes"]):not([href="/recipes/new"]):not([href*="#"])');
}

export async function publicRecipeHrefByChef(page: Page, username: string) {
  await page.goto('/recipes');
  await expect(page.getByRole('heading', { name: /recipes worth opening/i })).toBeVisible({
    timeout: 10_000,
  });
  let foundHref = '';
  await expect.poll(async () => {
    const escapedUsername = escapeRegExp(username);
    foundHref = await page.locator('main').evaluate((main, escapedChefUsername) => {
      const attribution = new RegExp(`\\bBy\\s+${escapedChefUsername}`, 'i');
      const links = Array.from(
        main.querySelectorAll<HTMLAnchorElement>(
          'a[href^="/recipes/"]:not([href="/recipes"]):not([href="/recipes/new"]):not([href*="#"])',
        ),
      );
      for (const link of links) {
        const row = link.closest('li') ?? link;
        if (attribution.test(row.textContent ?? '')) {
          return link.getAttribute('href') ?? '';
        }
      }
      return '';
    }, escapedUsername);
    return foundHref;
  }, {
    message: `expected a visible public recipe by ${username}`,
    timeout: 10_000,
  }).not.toBe('');
  return foundHref;
}

export async function openPublicRecipeByChef(page: Page, username: string) {
  const href = await publicRecipeHrefByChef(page, username);
  await page.goto(href);
  await expect(page).toHaveURL(/\/recipes\/[^/]+$/, { timeout: 10_000 });
}

export async function publicRecipeHref(page: Page) {
  await page.goto('/recipes');
  await expect(page.getByRole('heading', { name: /recipes worth opening/i })).toBeVisible({
    timeout: 10_000,
  });
  const href = await publicRecipeLinks(page).first().getAttribute('href');
  expect(href, 'expected a visible public recipe').toBeTruthy();
  return href!;
}

export async function openPublicRecipe(page: Page) {
  const href = await publicRecipeHref(page);
  await page.goto(href);
  await expect(page).toHaveURL(/\/recipes\/[^/]+$/, { timeout: 10_000 });
}

export async function currentRecipeOwnerUsername(page: Page) {
  const href = await page
    .locator('main a[href^="/users/"]')
    .first()
    .getAttribute('href');
  expect(href, 'expected recipe owner link').toMatch(/^\/users\/[^/]+$/);
  return href!.split('/').at(-1)!;
}
