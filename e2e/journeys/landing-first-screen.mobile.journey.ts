// The signed-out landing hero's actions are on screen when a phone first opens the page (read-only,
// signed out, both themes). landing-readability.journey.ts checks each action once it is scrolled
// into view or focused; this checks the first screen, before the visitor scrolls, on every phone
// shape below: each action must lie wholly inside the viewport, above the bottom safe area, with
// nothing (the fixed tab bar, the sticky header) painted over any of the nine points
// support/readability.ts samples on it.
//
// Playwright's iPhone devices leave Safari's own bars out of the viewport, so the viewport is the
// part of the screen the page owns. The iPhone Duo entry follows the same rule, measured from Ari's
// screenshot of one Duo screen in Safari (1398 x 2034 px, 2026-10-26): the header's 168 px and the
// description's 96 px lines are 56 and 32 CSS px, so 3 px make one CSS px and the screen is 466 x 678.
// Safari's toolbar takes the right-hand strip, leaving the page 1146 px, 382 wide; the Smart App
// Banner takes the top 147 px. The tab bar's bottom edge sits 515 px into the page, and the tab bar
// keeps max(1rem, env(safe-area-inset-bottom)) below it, so the page ends at 531, just above
// Safari's floating address bar, which starts at 546.
import { devices, type Browser, type BrowserContextOptions, type TestInfo } from "@playwright/test";
import { THEME_STORAGE_KEY } from "../../app/lib/client-storage-schema";
import { test, expect, appendConsoleIssues, assertNoConsoleIssues, watchConsole } from "./support/journey";
import { waitForHydrationOnLoad } from "./support/app-ready";
import { waitForHydration } from "./support/navigation";
import { coveringElements } from "./support/readability";

type Scheme = "light" | "dark";

interface Phone {
  name: string;
  context: BrowserContextOptions;
}

function phone(name: string): Phone {
  return { name, context: { ...devices[name] } };
}

const DUO_SCREEN: Phone = {
  name: "iPhone Duo, one screen",
  context: {
    ...phone("iPhone 15").context,
    viewport: { width: 382, height: 531 },
    screen: { width: 466, height: 678 },
  },
};

const PHONES: Phone[] = [phone("iPhone 13 Mini"), phone("iPhone 15"), phone("iPhone 15 Pro Max"), DUO_SCREEN];

const ACTIONS = ["Start Your Kitchen", "Log in", "Search Recipes"] as const;

interface Placement {
  action: string;
  box: { top: number; bottom: number; left: number; right: number };
  /** The bottom of the area the page may use: the viewport less env(safe-area-inset-bottom). */
  usableBottom: number;
  viewportWidth: number;
  covered: string[];
}

async function firstScreen(browser: Browser, testInfo: TestInfo, device: Phone, scheme: Scheme): Promise<Placement[]> {
  const context = await browser.newContext({ ...device.context, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  waitForHydrationOnLoad(page);
  const watcher = watchConsole(page);
  const placements: Placement[] = [];
  try {
    await page.addInitScript(({ key, choice }) => {
      localStorage.setItem(key, choice);
    }, { key: THEME_STORAGE_KEY, choice: scheme });
    await page.goto("/");
    await waitForHydration(page);
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark")), "the page shows the stored theme").toBe(scheme === "dark");
    // The hero's height depends on its typeface and its photo.
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const photo = page.getByRole("img", { name: "Dinner table with shared dishes" });
    await photo.evaluate((image) => (image as HTMLImageElement).decode());
    expect(await page.evaluate(() => window.scrollY), "the page is at its top").toBe(0);

    const usableBottom = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;visibility:hidden;padding-bottom:env(safe-area-inset-bottom)";
      document.body.append(probe);
      const inset = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
      probe.remove();
      return window.innerHeight - inset;
    });
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    const heading = page.getByRole("heading", { level: 1, name: "Your food should look as good as it tastes." });
    const hero = page.locator("section").filter({ has: heading });
    for (const name of ACTIONS) {
      const action = hero.getByRole("link", { name, exact: true });
      const box = await action.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
      });
      placements.push({ action: name, box, usableBottom, viewportWidth, covered: await coveringElements(action) });
    }
    const shot = testInfo.outputPath(`landing-first-screen-${device.name.replace(/\W+/g, "-")}-${scheme}.png`);
    await page.screenshot({ path: shot });
    await testInfo.attach(`${device.name}, ${scheme}`, { path: shot, contentType: "image/png" });
  } catch (error) {
    throw appendConsoleIssues(error, watcher.issues);
  } finally {
    watcher.dispose();
    await context.close();
  }
  assertNoConsoleIssues(watcher.issues);
  return placements;
}

async function everyActionOnFirstScreen(browser: Browser, testInfo: TestInfo, scheme: Scheme): Promise<void> {
  const results: Array<{ phone: string; placements: Placement[] }> = [];
  try {
    for (const device of PHONES) {
      const placements = await firstScreen(browser, testInfo, device, scheme);
      results.push({ phone: device.name, placements });
      for (const { action, box, usableBottom, viewportWidth, covered } of placements) {
        const where = `${device.name}, ${scheme}: "${action}" (top ${box.top}, bottom ${box.bottom}, usable to ${usableBottom})`;
        expect.soft(box.top, `${where} starts on screen`).toBeGreaterThanOrEqual(0);
        expect.soft(box.bottom, `${where} ends above the bottom safe area`).toBeLessThanOrEqual(usableBottom);
        expect.soft(box.left, `${where} starts inside the left edge`).toBeGreaterThanOrEqual(0);
        expect.soft(box.right, `${where} ends inside the right edge`).toBeLessThanOrEqual(viewportWidth);
        expect.soft(covered, `${where}: what covers it`).toEqual([]);
      }
    }
  } finally {
    await testInfo.attach(`landing-first-screen-${scheme}.json`, { body: JSON.stringify(results, null, 2), contentType: "application/json" });
  }
}

test.describe("Signed-out landing hero on a phone's first screen", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("every hero action is on screen and uncovered at page load in the light theme", async ({ browser }, testInfo) => {
    await everyActionOnFirstScreen(browser, testInfo, "light");
  });

  test("every hero action is on screen and uncovered at page load in the dark theme", async ({ browser }, testInfo) => {
    await everyActionOnFirstScreen(browser, testInfo, "dark");
  });
});
