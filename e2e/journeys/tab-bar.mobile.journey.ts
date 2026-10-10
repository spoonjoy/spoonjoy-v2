// The tab bar on iPhone (chef session). It is navigation only and the same on every page: Kitchen,
// Recipes, Cookbooks and Shopping as four equal tabs, each an icon over its label, and Search in its
// own circle. The tab that owns the page is marked current. The bar is solid, so no page text shows
// through, every target is at least 44 px, and the page's bottom padding clears it, so the last
// control on a page never sits under it (R-M3-4). What the old dock's drawer held now lives on the
// pages: the Recipes switch (Mine, Saved, Everyone), Chefs on the Kitchen page, and Log out in
// Account settings.
//
// Read-only, except that Log out drops this test's own copy of the chef's stored session cookie.
// Logging out ends only the session in this browser context (sessions are cookies; logging out
// revokes nothing on the server), so the stored chef session other journeys start from keeps
// working.
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./support/journey";
import { pathUrl, waitForHydration, waitForServiceWorker } from "./support/navigation";
import { personaStorageStatePath } from "./support/personas";

const MIN_TARGET_PX = 44;

// Every page that shows the tab bar, with the tab that owns it. A cookbook's own page keeps the
// tab bar (R-M3-2).
const TAB_PAGES: ReadonlyArray<readonly [path: string, currentTab: string]> = [
  ["/", "Kitchen"],
  ["/account/settings", "Kitchen"],
  ["/chefs", "Kitchen"],
  ["/users/qa_kitchen_friend", "Kitchen"],
  ["/my-recipes", "Recipes"],
  ["/saved-recipes", "Recipes"],
  ["/recipes", "Recipes"],
  ["/recipes/qa-kitchen-recipe-lemon-rice", "Recipes"],
  ["/cookbooks", "Cookbooks"],
  ["/cookbooks/qa-kitchen-cookbook-weeknight", "Cookbooks"],
  ["/shopping-list", "Shopping"],
  ["/search", "Search"],
];


// Anything a keyboard or a tap can reach.
const FOCUSABLE = "a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])";

async function boxOf(locator: Locator, what: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${what} has no bounding box (not rendered).`);
  return box;
}

async function expectTargetsAtLeast44(targets: Locator, what: string): Promise<void> {
  const count = await targets.count();
  expect(count, `${what}: number of targets`).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const box = await boxOf(targets.nth(index), `${what} target ${index + 1}`);
    expect(box.width, `${what} target ${index + 1} width`).toBeGreaterThanOrEqual(MIN_TARGET_PX);
    expect(box.height, `${what} target ${index + 1} height`).toBeGreaterThanOrEqual(MIN_TARGET_PX);
  }
}

// The fill of an element's background, as alpha 0-255. The probe starts transparent, so a color the
// canvas cannot parse reads as 0 and fails.
async function backgroundAlpha(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const probe = document.createElement("canvas").getContext("2d");
    if (!probe) throw new Error("No 2D canvas context.");
    probe.fillStyle = "rgba(0, 0, 0, 0)";
    probe.fillStyle = getComputedStyle(element).backgroundColor;
    probe.fillRect(0, 0, 1, 1);
    return probe.getImageData(0, 0, 1, 1).data[3];
  });
}

// Scrolled to the very bottom, main's bottom padding covers everything from the tab bar's top edge
// to the bottom of the screen, and the last focusable thing in main ends above the tab bar.
async function expectDockClearsMain(page: Page, path: string): Promise<void> {
  const dock = page.getByRole("navigation", { name: "Spoonjoy navigation" });
  const main = page.locator("main#main");

  await page.goto(path);
  await waitForHydration(page);
  await expect(dock, `${path}: dock`).toBeVisible();
  await expectTargetsAtLeast44(dock.locator("a, button"), `${path} dock`);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("The iPhone project always sets a viewport.");
  const dockBox = await boxOf(dock, `${path} dock`);
  const paddingBottom = await main.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingBottom));
  expect(paddingBottom, `${path}: main's bottom padding against the dock's top edge`).toBeGreaterThanOrEqual(viewport.height - dockBox.y);

  const lastBox = await boxOf(main.locator(FOCUSABLE).filter({ visible: true }).last(), `${path} last focusable element in main`);
  expect(lastBox.y + lastBox.height, `${path}: bottom edge of the last focusable element in main`).toBeLessThanOrEqual(dockBox.y);
}

test.describe("Tab bar on iPhone", () => {
  // The stored session path, not persona("chef").storageState: persona() reads the per-run
  // credentials file, which `playwright test --list` must not need.
  test.use({ storageState: personaStorageStatePath("chef") });

  test("every page shows the same solid tab bar, evenly spaced, with the owning tab current", async ({ page }) => {
    const tabBar = page.getByRole("navigation", { name: "Spoonjoy navigation" });
    const tabList = tabBar.getByRole("list");
    const tabs = tabList.getByRole("link");
    const search = tabBar.getByRole("link", { name: "Search", exact: true });

    await page.goto("/");
    await waitForServiceWorker(page);

    for (const [path, currentTab] of TAB_PAGES) {
      await page.goto(path);
      await waitForHydration(page);
      await expect(tabBar, `${path}: tab bar`).toBeVisible();
      await expect(tabBar.getByRole("link"), `${path}: the tabs, in order`).toHaveText(["Kitchen", "Recipes", "Cookbooks", "Shopping", ""]);
      await expect(tabBar.getByRole("button"), `${path}: no page actions in the tab bar`).toHaveCount(0);
      await expect(page.getByTestId("phone-brand-bar"), `${path}: no sign-up bar for a signed-in chef`).toHaveCount(0);
      await expect(tabBar.locator('[aria-current="page"]'), `${path}: one current tab`).toHaveCount(1);
      await expect(tabBar.getByRole("link", { name: currentTab, exact: true }), `${path}: current tab`).toHaveAttribute("aria-current", "page");
      await expectTargetsAtLeast44(tabBar.getByRole("link"), `${path} tab bar`);

      // Page text must not show through: the bar and the search circle are fully opaque.
      expect(await backgroundAlpha(tabList), `${path}: tab bar background alpha (0-255)`).toBe(255);
      expect(await backgroundAlpha(search), `${path}: search circle background alpha (0-255)`).toBe(255);

      // The four tabs share the bar evenly.
      const widths: number[] = [];
      for (let index = 0; index < 4; index += 1) {
        widths.push((await boxOf(tabs.nth(index), `${path} tab ${index + 1}`)).width);
      }
      expect(Math.max(...widths) - Math.min(...widths), `${path}: widest tab minus narrowest tab (px)`).toBeLessThanOrEqual(1);
    }
  });

  test("the Recipes switch moves between Mine, Saved and Everyone under the Recipes tab", async ({ page, expectAccessible }) => {
    const tabBar = page.getByRole("navigation", { name: "Spoonjoy navigation" });
    const recipeLists = page.getByRole("navigation", { name: "Recipe lists" });

    await page.goto("/");
    await waitForHydration(page);
    await tabBar.getByRole("link", { name: "Recipes", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/my-recipes"));
    await expect(page.getByRole("heading", { level: 1, name: "My Recipes", exact: true })).toBeVisible();
    await expect(recipeLists.getByRole("link", { name: "Mine", exact: true })).toHaveAttribute("aria-current", "page");
    await expectTargetsAtLeast44(recipeLists.getByRole("link"), "Recipes switch");
    await expectAccessible();

    await recipeLists.getByRole("link", { name: "Saved", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/saved-recipes"));
    await expect(page.getByRole("heading", { level: 1, name: "Saved Recipes", exact: true })).toBeVisible();
    await expect(recipeLists.getByRole("link", { name: "Saved", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(tabBar.getByRole("link", { name: "Recipes", exact: true })).toHaveAttribute("aria-current", "page");

    await recipeLists.getByRole("link", { name: "Everyone", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/recipes"));
    await expect(recipeLists.getByRole("link", { name: "Everyone", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(tabBar.getByRole("link", { name: "Recipes", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("the Kitchen page reaches Chefs and Account settings", async ({ page }) => {
    const main = page.getByRole("main");

    await page.goto("/");
    await waitForHydration(page);
    await main.getByRole("link", { name: "Chefs", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/chefs"));
    await expect(page.getByRole("heading", { level: 1, name: "Chefs", exact: true })).toBeVisible();

    await page.goto("/");
    await waitForHydration(page);
    await main.getByRole("link", { name: "Kitchen settings", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/account/settings"));
    await expect(page.getByRole("heading", { level: 1, name: "Account settings", exact: true })).toBeVisible();
  });

  test("Log out in Account settings signs the phone out", async ({ page }, testInfo) => {
    const tabBar = page.getByRole("navigation", { name: "Spoonjoy navigation" });

    await page.goto("/account/settings");
    await waitForHydration(page);
    // Log out and the checks after it are full page loads; let this load's service-worker
    // registration finish first so none of them cancels it.
    await waitForServiceWorker(page);
    await page.getByRole("main").getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/login"));
    await expect(page.getByRole("heading", { level: 1, name: "Log in", exact: true })).toBeVisible();

    // The session is gone, not just this page: a signed-in page sends the phone to log in, and the
    // home page shows the signed-out tabs.
    await page.goto("/account/settings");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/");
    await expect(tabBar.getByRole("link")).toHaveText(["Home", "Recipes", "Log in", ""]);
    await expect(tabBar.getByRole("link", { name: "Log in", exact: true })).toHaveAttribute("href", "/login");

    // Signed out, a slim bar names Spoonjoy and offers sign-up above the page, so someone who
    // arrives from a shared recipe link sees whose site this is (product audit finding 18).
    await page.goto("/recipes/qa-kitchen-recipe-lemon-rice");
    const brandBar = page.getByTestId("phone-brand-bar");
    await expect(brandBar).toBeVisible();
    await expect(brandBar.getByRole("link", { name: "Spoonjoy" })).toHaveAttribute("href", "/");
    await expect(brandBar.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/signup");
    // The first screen someone sees from a shared link, for visual review.
    await testInfo.attach("signed-out-shared-recipe", { body: await page.screenshot(), contentType: "image/png" });

    // The public list: its first recipe shows on the first screen.
    await page.goto("/recipes");
    await expect(page.getByRole("heading", { level: 1, name: "Recipes worth opening." })).toBeVisible();
    await expect(brandBar).toBeVisible();
    await testInfo.attach("signed-out-recipes", { body: await page.screenshot(), contentType: "image/png" });
  });

  test("the page's bottom padding clears the tab bar on every page (R-M3-4)", async ({ page }) => {
    await page.goto("/");
    // The loop below makes a dozen full page loads back to back; let the first one's service-worker
    // registration finish so no later load cancels one in flight.
    await waitForServiceWorker(page);
    // iOS applies the safe-area insets the tab bar and the padding use only with viewport-fit=cover.
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /(?:^|,)\s*viewport-fit=cover\s*(?:,|$)/);

    for (const [path] of TAB_PAGES) {
      await expectDockClearsMain(page, path);
    }
  });
});
