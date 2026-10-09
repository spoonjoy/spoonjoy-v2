// Public recipe list (read-only, signed out): browsing reaches every public recipe, not only the 48
// newest (2026-10-09: the seeded risotto fell off the capped list and could not be reached). QA
// holds many unrelated recipes from other journeys and legacy data, well past one page, so "Show
// more" is there; nothing asserts counts or positions beyond that.
import { test, expect } from "./support/journey";
import { seededRecipeLink, waitForHydration } from "./support/navigation";
import { PAGER_OLDEST_RECIPE } from "../../scripts/seed-qa-kitchen.mjs";

const MAX_PAGES = 40;

test.describe("Public recipes", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("Show more appends the next recipes in place and moves focus to the first new one", async ({ page, expectAccessible }) => {
    const main = page.getByRole("main");
    const showMore = main.getByRole("link", { name: "Show more recipes", exact: true });
    const rows = main.getByRole("listitem");

    await page.goto("/recipes");
    await waitForHydration(page);
    await expect(page.getByRole("heading", { name: "All public recipes", exact: true })).toBeVisible();
    // Without JavaScript it is a link to the page after a cursor.
    await expect(showMore).toHaveAttribute("href", /^\/recipes\?after=[A-Za-z0-9_-]+$/);
    const firstPage = await rows.count();
    await expectAccessible();

    await showMore.click();
    await expect.poll(() => rows.count()).toBeGreaterThan(firstPage);
    await expect(rows.nth(firstPage).getByRole("link")).toBeFocused();
    await expect(page.getByTestId("show-more-status")).toHaveText(`Showing ${await rows.count()} recipes`);
    // Appending stays on /recipes, so Back leaves the list rather than undoing a page.
    await expect(page).toHaveURL(/\/recipes$/);
    await expectAccessible();
  });

  test("following the next-page links reaches the oldest seeded recipe", async ({ page }) => {
    test.setTimeout(180_000);
    const main = page.getByRole("main");
    // The paging fixture's recipes are dated 2020, older than anything else on QA, so its oldest
    // one is the last row the newest-first list reaches.
    const oldest = seededRecipeLink(main, PAGER_OLDEST_RECIPE.title, `/recipes/${PAGER_OLDEST_RECIPE.id}`);
    const showMore = main.getByRole("link", { name: "Show more recipes", exact: true });

    let path: string | null = "/recipes";
    let pages = 0;
    while (path && pages < MAX_PAGES) {
      await page.goto(path);
      pages += 1;
      if (await oldest.isVisible()) break;
      path = (await showMore.count()) > 0 ? await showMore.getAttribute("href") : null;
    }

    await expect(oldest).toBeVisible();
  });
});
