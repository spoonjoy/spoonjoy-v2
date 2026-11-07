// The site footer on a phone (read-only). Scrolled to the bottom of a page, the footer shows whole
// above the floating tab bar, with nothing painted over its link or its button, on the iPhone the
// project emulates and on the iPhone Duo's closed outer screen (382 x 531 CSS px, measured in
// landing-first-screen.mobile.journey.ts).
import { devices, type Browser, type BrowserContextOptions } from "@playwright/test";
import { test, expect } from "./support/journey";
import { waitForHydration } from "./support/navigation";
import { personaStorageStatePath } from "./support/personas";
import { coveringElements } from "./support/readability";

const DUO_SCREEN: BrowserContextOptions = {
  ...devices["iPhone 15"],
  viewport: { width: 382, height: 531 },
  screen: { width: 466, height: 678 },
};

async function expectFooterAboveTabBar(browser: Browser, context: BrowserContextOptions, storageState: string | { cookies: []; origins: [] }, path: string): Promise<void> {
  const browserContext = await browser.newContext({ ...context, storageState });
  try {
    const page = await browserContext.newPage();
    await page.goto(path);
    await waitForHydration(page);
    const tabBar = page.getByRole("navigation", { name: "Spoonjoy navigation" });
    await expect(tabBar, `${path}: tab bar`).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement!.scrollHeight));
    await expect.poll(() => page.evaluate(() => Math.ceil(window.scrollY + window.innerHeight) >= document.scrollingElement!.scrollHeight - 1), { message: `${path}: scrolled to the bottom` }).toBe(true);

    const footer = page.getByRole("contentinfo");
    const footerBox = (await footer.boundingBox())!;
    const barBox = (await tabBar.boundingBox())!;
    expect(footerBox.y, `${path}: footer top is on screen`).toBeGreaterThanOrEqual(0);
    expect(footerBox.y + footerBox.height, `${path}: footer ends above the tab bar`).toBeLessThanOrEqual(barBox.y);
    expect(await coveringElements(footer.getByRole("link", { name: "Built with Ouro HX", exact: true })), `${path}: link uncovered`).toEqual([]);
    expect(await coveringElements(footer.getByRole("button", { name: "See all the components", exact: true })), `${path}: button uncovered`).toEqual([]);
  } finally {
    await browserContext.close();
  }
}

test.describe("Site footer on a phone", () => {
  test("shows whole above the tab bar at the bottom of the Kitchen, signed in", async ({ browser }) => {
    await expectFooterAboveTabBar(browser, devices["iPhone 15"], personaStorageStatePath("chef"), "/");
  });

  test("shows whole above the tab bar at the bottom of a recipe, signed in", async ({ browser }) => {
    await expectFooterAboveTabBar(browser, devices["iPhone 15"], personaStorageStatePath("chef"), "/recipes/qa-kitchen-recipe-lemon-rice");
  });

  test("shows whole above the tab bar at the bottom of the public recipes, signed out", async ({ browser }) => {
    await expectFooterAboveTabBar(browser, devices["iPhone 15"], { cookies: [], origins: [] }, "/recipes");
  });

  test("shows whole above the tab bar on the iPhone Duo's outer screen", async ({ browser }) => {
    await expectFooterAboveTabBar(browser, DUO_SCREEN, personaStorageStatePath("chef"), "/");
  });

  // X-ray's bar floats at the bottom of the screen, where the tab bar's middle tabs are.
  test("X-ray's bar floats above the tab bar, whose tabs stay within reach", async ({ page }) => {
    await page.goto("/recipes?xray");
    await waitForHydration(page);
    const bar = page.getByRole("region", { name: "X-ray", exact: true });
    const tabBar = page.getByRole("navigation", { name: "Spoonjoy navigation" });
    await expect(bar).toBeVisible();
    await expect(tabBar).toBeVisible();
    const barBox = (await bar.boundingBox())!;
    const tabsBox = (await tabBar.boundingBox())!;
    expect(barBox.y + barBox.height, "X-ray's bar ends above the tab bar").toBeLessThanOrEqual(tabsBox.y);
    await tabBar.getByRole("link", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("steps aside in cook mode, the full-screen view", async ({ browser }) => {
    const context = await browser.newContext({ ...devices["iPhone 15"], storageState: { cookies: [], origins: [] } });
    try {
      const page = await context.newPage();
      await page.goto("/test-kitchen");
      await waitForHydration(page);
      await expect(page.getByRole("contentinfo")).toBeVisible();
      await page.getByRole("button", { name: "Start cooking", exact: true }).click();
      await expect(page.locator("#cook")).toBeVisible();
      await expect(page.getByRole("contentinfo")).toBeHidden();
    } finally {
      await context.close();
    }
  });
});
