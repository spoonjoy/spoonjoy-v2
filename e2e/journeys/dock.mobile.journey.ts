// The dock on iPhone (chef session). The pantry behaves like a menu: its button says whether it is
// open (aria-expanded) and which element it controls, and its own button, Escape and a tap outside
// it each close it. It holds Account and Log out, the only way to reach either on a phone, where the
// desktop navigation is hidden. Every dock and pantry target is at least 44 px. And the page's
// bottom padding clears the dock, so the last control on a page never sits under it (R-M3-4).
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

// Pages that show the dock, one per dock layout (the recipe page has the widest, with three tools),
// plus a cookbook's own page, which keeps the dock (R-M3-2).
const DOCK_PAGES = [
  "/",
  "/recipes",
  "/my-recipes",
  "/saved-recipes",
  "/cookbooks",
  "/cookbooks/qa-kitchen-cookbook-weeknight",
  "/shopping-list",
  "/chefs",
  "/search",
  "/account/settings",
  "/users/qa_kitchen_friend",
  "/recipes/qa-kitchen-recipe-lemon-rice",
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

// Scrolled to the very bottom, main's bottom padding covers everything from the dock's top edge to
// the bottom of the screen, and the last focusable thing in main ends above the dock.
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

test.describe("Dock on iPhone", () => {
  // The stored session path, not persona("chef").storageState: persona() reads the per-run
  // credentials file, which `playwright test --list` must not need.
  test.use({ storageState: personaStorageStatePath("chef") });

  test("the pantry opens and closes like a menu, and its Account link lands on account settings", async ({ page, expectAccessible }) => {
    const dock = page.getByRole("navigation", { name: "Spoonjoy navigation" });
    const toggle = dock.getByRole("button", { name: "Pantry navigation", exact: true });
    const pantry = page.getByTestId("mobile-pantry");
    const kitchenHeading = page.getByRole("heading", { level: 1, name: "My Kitchen", exact: true });

    await page.goto("/");
    await waitForHydration(page);
    await expect(kitchenHeading).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveAttribute("aria-controls", "mobile-pantry");
    await expect(pantry).toBeHidden();

    // Its own button opens and closes it.
    await toggle.click();
    await expect(pantry).toBeVisible();
    await expect(pantry).toHaveAttribute("id", "mobile-pantry");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expectTargetsAtLeast44(pantry.locator("a, button"), "pantry");
    await expectAccessible();

    await toggle.click();
    await expect(pantry).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // Escape closes it and puts focus back on its button.
    await toggle.click();
    await expect(pantry).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(pantry).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();

    // A tap outside it closes it, and does not also open whatever is under the tap.
    await toggle.click();
    await expect(pantry).toBeVisible();
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("The iPhone project always sets a viewport.");
    await page.touchscreen.tap(viewport.width / 2, 160);
    await expect(pantry).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page).toHaveURL(pathUrl("/"));
    await expect(kitchenHeading).toBeVisible();

    // Account is in the pantry and lands on account settings.
    await toggle.click();
    await pantry.getByRole("link", { name: "Account", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/account/settings"));
    await expect(page.getByRole("heading", { level: 1, name: "Account settings", exact: true })).toBeVisible();
    await expect(pantry).toBeHidden();
  });

  test("Log out in the pantry signs the phone out", async ({ page }) => {
    const dock = page.getByRole("navigation", { name: "Spoonjoy navigation" });
    const pantry = page.getByTestId("mobile-pantry");

    await page.goto("/");
    await waitForHydration(page);
    // Log out and the checks after it are full page loads; let this load's service-worker
    // registration finish first so none of them cancels it.
    await waitForServiceWorker(page);
    await expect(page.getByRole("heading", { level: 1, name: "My Kitchen", exact: true })).toBeVisible();

    await dock.getByRole("button", { name: "Pantry navigation", exact: true }).click();
    await pantry.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/login"));
    await expect(page.getByRole("heading", { level: 1, name: "Log In", exact: true })).toBeVisible();

    // The session is gone, not just this page: a signed-in page sends the phone to log in, and the
    // home page shows the signed-out dock.
    await page.goto("/account/settings");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/");
    await expect(dock.getByRole("link", { name: "Log in", exact: true })).toHaveAttribute("href", "/login");
    await expect(dock.getByRole("button", { name: "Pantry navigation", exact: true })).toHaveCount(0);
  });

  test("the page's bottom padding clears the dock on every dock layout (R-M3-4)", async ({ page }) => {
    await page.goto("/");
    // The loop below makes a dozen full page loads back to back; let the first one's service-worker
    // registration finish so no later load cancels one in flight.
    await waitForServiceWorker(page);
    // iOS applies the safe-area insets the dock and the padding use only with viewport-fit=cover.
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /(?:^|,)\s*viewport-fit=cover\s*(?:,|$)/);

    for (const path of DOCK_PAGES) {
      await expectDockClearsMain(page, path);
    }
  });
});
