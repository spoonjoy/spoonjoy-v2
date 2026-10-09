// Chef profile paging (read-only, signed out). scripts/seed-qa-kitchen.mjs seeds qa_kitchen_pager
// with 60 public recipes; the profile shows 24 a page, so the first Show more appends a second
// page and the next one reaches the last (12 more), where the button goes away. The run saves
// screenshots of each state, at 390 px (iPhone) and 1280 px (desktop), and of the first page in
// dark mode, so a reviewer sees the real route layout: the list column, the Cookbooks column on
// desktop, and Recent cooks below.
import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "./support/journey";
import { waitForHydration } from "./support/navigation";

const PAGER = "/users/qa_kitchen_pager";
const PAGE_SIZE = 24;
const TOTAL = 60;

function viewportFor(testInfo: TestInfo) {
  return testInfo.project.name === "iphone-webkit" ? { width: 390, height: 844 } : { width: 1280, height: 800 };
}

async function capture(page: Page, testInfo: TestInfo, name: string, fullPage = false) {
  const width = viewportFor(testInfo).width;
  await testInfo.attach(`profile-pager-${name}-${width}`, {
    body: await page.screenshot({ fullPage, animations: "disabled" }),
    contentType: "image/png",
  });
}

async function centre(page: Page, selector: string) {
  await page.locator(selector).last().evaluate((element) => element.scrollIntoView({ block: "center" }));
}

test.describe("Chef profile paging", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("Show more appends each page in place, then disappears at the last one", async ({ page, expectAccessible }, testInfo) => {
    await page.setViewportSize(viewportFor(testInfo));
    const main = page.getByRole("main");
    const recipesSection = main.locator("section").filter({ has: page.getByRole("heading", { name: "Recipes", exact: true }) }).last();
    const rows = recipesSection.getByRole("article");
    const showMore = main.getByRole("link", { name: "Show more recipes", exact: true });
    const recentCooks = main.getByRole("heading", { name: "Recent cooks", exact: true });

    await page.goto(PAGER);
    await waitForHydration(page);
    await expect(rows).toHaveCount(PAGE_SIZE);
    await expect(recipesSection.getByText(`${TOTAL} total`)).toBeVisible();
    // Without JavaScript the button is a link to the next page after a cursor.
    await expect(showMore).toHaveAttribute("href", /^\/users\/qa_kitchen_pager\?after=[A-Za-z0-9_-]+$/);
    // The button sits under the list and above Recent cooks.
    const buttonBox = await showMore.boundingBox();
    const lastRowBox = await rows.last().boundingBox();
    const recentCooksBox = await recentCooks.boundingBox();
    expect(buttonBox!.y).toBeGreaterThan(lastRowBox!.y + lastRowBox!.height - 1);
    expect(recentCooksBox!.y).toBeGreaterThan(buttonBox!.y + buttonBox!.height);
    await expectAccessible();
    await centre(page, '[data-testid="show-more"]');
    await capture(page, testInfo, "a-first-page-end");
    await capture(page, testInfo, "a-first-page-full", true);

    await showMore.click();
    await expect(rows).toHaveCount(PAGE_SIZE * 2);
    // Focus moves to the first appended recipe, and the change is announced.
    await expect(rows.nth(PAGE_SIZE).getByRole("link").first()).toBeFocused();
    await expect(page.getByTestId("show-more-status")).toHaveText(`Showing ${PAGE_SIZE * 2} recipes`);
    await expect(showMore).toBeVisible();
    // Appending stays on the profile URL, so Back leaves the profile rather than undoing a page.
    await expect(page).toHaveURL(new RegExp(`${PAGER}$`));
    await rows.nth(PAGE_SIZE).evaluate((element) => element.scrollIntoView({ block: "center" }));
    await capture(page, testInfo, "b-after-one-click-appended");
    await centre(page, '[data-testid="show-more"]');
    await capture(page, testInfo, "b-after-one-click-button");

    await showMore.click();
    await expect(rows).toHaveCount(TOTAL);
    await expect(rows.nth(PAGE_SIZE * 2).getByRole("link").first()).toBeFocused();
    await expect(showMore).toHaveCount(0);
    await expectAccessible();
    // With the button gone, Recent cooks follows the last row with no gap where the button was:
    // closer than on the first page, where the button sat between them.
    const lastPageRowBox = await rows.last().boundingBox();
    const lastPageRecentCooksBox = await recentCooks.boundingBox();
    const firstPageGap = recentCooksBox!.y - (lastRowBox!.y + lastRowBox!.height);
    const lastPageGap = lastPageRecentCooksBox!.y - (lastPageRowBox!.y + lastPageRowBox!.height);
    expect(lastPageGap).toBeGreaterThan(0);
    expect(lastPageGap).toBeLessThan(firstPageGap - buttonBox!.height);
    await rows.last().evaluate((element) => element.scrollIntoView({ block: "center" }));
    await capture(page, testInfo, "c-last-page-end");
    // Sixty rows make a full-page shot taller than a screenshot can be on a phone, so the third
    // view is the end of the list with Recent cooks below it, in one screen.
    await recentCooks.evaluate((element) => element.scrollIntoView({ block: "end" }));
    await capture(page, testInfo, "c-last-page-list-to-recent-cooks");

    // Open an appended recipe, then come back. Record what the list shows on return, for the
    // reviewer; the profile URL never held the appended pages.
    await rows.nth(PAGE_SIZE + 1).getByRole("link").first().click();
    await expect(page).toHaveURL(/\/recipes\//);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${PAGER}$`));
    await expect(rows.first()).toBeVisible();
    testInfo.annotations.push({ type: "rows after back", description: String(await rows.count()) });
    await capture(page, testInfo, "e-after-back");
  });

  test("the first page in dark mode", async ({ page, expectAccessible }, testInfo) => {
    await page.setViewportSize(viewportFor(testInfo));
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(PAGER);
    await waitForHydration(page);
    await expect(page.getByRole("main").getByRole("link", { name: "Show more recipes", exact: true })).toBeVisible();
    await centre(page, '[data-testid="show-more"]');
    await capture(page, testInfo, "d-dark-first-page-end");
    await expectAccessible();
  });
});
