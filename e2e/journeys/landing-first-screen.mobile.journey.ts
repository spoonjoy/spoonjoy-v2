// The signed-out landing hero's actions are on screen when a phone first opens the page (read-only,
// signed out, both themes). landing-readability.journey.ts checks each action once it is scrolled
// into view or focused; this checks the first screen, before the visitor scrolls, on every phone
// shape below: each action must lie wholly inside the viewport, above the bottom safe area, with
// nothing (the fixed tab bar, the sticky header) painted over any of the nine points
// support/readability.ts samples on it, and with its label inside its own border.
//
// Playwright's newer iPhone devices leave Safari's own bars out of the viewport, so the viewport is
// the part of the screen the page owns. "iPhone SE" (320 x 568) is the narrowest width we support,
// the width a 13 mini gives with Display Zoom; its height is the whole screen.
//
// The iPhone Duo entry is its closed outer screen, measured from Ari's screenshot of the landing page
// in Safari on it (1398 x 2034 screenshot pixels, 2026-10-26). The header's 168 pixels and the
// description's 96-pixel line spacing are 56 and 32 CSS px, so 3 screenshot pixels make one CSS px
// and the screen is 466 x 678 CSS px, not the 669 x 951 inner screen app/lib/fold.ts describes.
// Safari's toolbar takes a 252-pixel strip on the right, leaving the page 1146 pixels (382 CSS px)
// wide, and the Smart App Banner takes the top 147 pixels. Measured in CSS px from the top of the
// page below that banner, the tab bar's bottom edge is at 515, and the tab bar keeps
// max(1rem, env(safe-area-inset-bottom)) below it, so the page ends at 531, above Safari's floating
// address bar, which starts at 546.
//
// Only a short or narrow phone (the Duo's outer screen, the SE) gets the compact hero: a 32px headline
// and the description's first clause. A phone at least 360 wide and 600 tall has room for the 36px
// headline and the whole description, and still shows every action above the tab bar. The Duo's
// inner screen (669 x 951 points, app/lib/fold.ts) and a tablet in portrait show the wide hero, which
// fills 70% of the screen so the page does not end in a blank band above the tab bar.
import { devices, type Browser, type BrowserContextOptions, type TestInfo } from "@playwright/test";
import { THEME_STORAGE_KEY } from "../../app/lib/client-storage-schema";
import { test, expect, appendConsoleIssues, assertNoConsoleIssues, watchConsole } from "./support/journey";
import { waitForHydrationOnLoad } from "./support/app-ready";
import { waitForHydration } from "./support/navigation";
import { coveringElements } from "./support/readability";

type Scheme = "light" | "dark";

/** Compact: a 32px headline and the description's first clause. Roomy: a 36px headline or larger and
 * the whole description. */
type Hero = "compact" | "roomy";

interface Phone {
  name: string;
  context: BrowserContextOptions;
  hero: Hero;
}

function phone(name: string, hero: Hero): Phone {
  return { name, context: { ...devices[name] }, hero };
}

const DUO_SCREEN: Phone = {
  name: "iPhone Duo, one screen",
  context: {
    ...devices["iPhone 15"],
    viewport: { width: 382, height: 531 },
    screen: { width: 466, height: 678 },
  },
  hero: "compact",
};

const DUO_OPEN: Phone = {
  name: "iPhone Duo, opened tall",
  context: {
    ...devices["iPhone 15"],
    viewport: { width: 669, height: 951 },
    screen: { width: 669, height: 951 },
  },
  hero: "roomy",
};

const PHONES: Phone[] = [
  phone("iPhone SE", "compact"),
  phone("iPhone 13 Mini", "roomy"),
  phone("iPhone 15", "roomy"),
  phone("iPhone 15 Pro Max", "roomy"),
  DUO_SCREEN,
  DUO_OPEN,
  phone("iPad Pro 11", "roomy"),
];

const REST_OF_DESCRIPTION = ", the notes you learn by doing, and the cookbooks that grow out of real meals";

const ACTIONS = ["Start Your Kitchen", "Log in", "Search Recipes"] as const;

interface Placement {
  action: string;
  box: { top: number; bottom: number; left: number; right: number };
  /** The bottom of the area the page may use: the viewport less env(safe-area-inset-bottom). */
  usableBottom: number;
  viewportWidth: number;
  covered: string[];
  /** Where the label (its words and icon) and the inside of the action's border fall across the
   * screen; a button never wraps its label, so a long one spills past the border. */
  label: { left: number; right: number; innerLeft: number; innerRight: number };
  /** Text in the action that is drawn in a fallback font because its web font has not loaded. */
  fallbackFont: string[];
}

interface HeroShape {
  headlinePx: number;
  description: string;
  heroHeight: number;
  viewportHeight: number;
}

async function firstScreen(browser: Browser, testInfo: TestInfo, device: Phone, scheme: Scheme): Promise<{ placements: Placement[]; shape: HeroShape }> {
  const context = await browser.newContext({ ...device.context, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  waitForHydrationOnLoad(page);
  const watcher = watchConsole(page);
  const placements: Placement[] = [];
  let shape: HeroShape | undefined;
  try {
    await page.addInitScript(({ key, choice }) => {
      localStorage.setItem(key, choice);
    }, { key: THEME_STORAGE_KEY, choice: scheme });
    await page.goto("/");
    await waitForHydration(page);
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark")), "the page shows the stored theme").toBe(scheme === "dark");
    // The hero's height depends on its typeface; the photo only has to be there for the screenshot.
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const photo = page.getByRole("img", { name: "Dinner table with shared dishes" });
    await photo.evaluate((image) => (image as HTMLImageElement).decode());
    expect(await page.evaluate(() => window.scrollY), "the page is at its top").toBe(0);

    // Playwright's WebKit reports a zero bottom safe area; a real phone may not.
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
    shape = {
      headlinePx: await heading.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
      description: await heading.evaluate((element) => (element.nextElementSibling as HTMLElement).innerText.trim()),
      heroHeight: await hero.evaluate((element) => element.getBoundingClientRect().height),
      viewportHeight: await page.evaluate(() => window.innerHeight),
    };
    for (const name of ACTIONS) {
      const action = hero.getByRole("link", { name, exact: true });
      const box = await action.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
      });
      // The words and the icon only: the button's own decoration reaches a pixel past its padding on
      // every phone, so the button's scrollWidth can't tell a spilled label. No label at all fails.
      const label = await action.evaluate((element) => {
        const rects: DOMRect[] = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          rects.push(...Array.from(range.getClientRects()));
        }
        element.querySelectorAll("svg").forEach((icon) => rects.push(icon.getBoundingClientRect()));
        const box = element.getBoundingClientRect();
        return {
          left: rects.length ? Math.min(...rects.map((rect) => rect.left)) : NaN,
          right: rects.length ? Math.max(...rects.map((rect) => rect.right)) : NaN,
          innerLeft: box.left + element.clientLeft,
          innerRight: box.left + element.clientLeft + element.clientWidth,
        };
      });
      const fallbackFont = await action.evaluate((element) => {
        const missing: string[] = [];
        // FontFaceSet.check (is this font loaded?), bound once; it is not Playwright's checkbox check().
        const fontIsLoaded = document.fonts.check.bind(document.fonts);
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent?.trim();
          if (!text || !node.parentElement) continue;
          const style = getComputedStyle(node.parentElement);
          const family = style.fontFamily.split(",")[0].trim();
          if (!fontIsLoaded(`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${family}`, text)) missing.push(`${text} (${family})`);
        }
        return missing;
      });
      placements.push({ action: name, box, usableBottom, viewportWidth, covered: await coveringElements(action), label, fallbackFont });
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
  return { placements, shape: shape! };
}

async function everyActionOnFirstScreen(browser: Browser, testInfo: TestInfo, scheme: Scheme): Promise<void> {
  const results: Array<{ phone: string; placements: Placement[]; shape: HeroShape }> = [];
  try {
    for (const device of PHONES) {
      const { placements, shape } = await firstScreen(browser, testInfo, device, scheme);
      results.push({ phone: device.name, placements, shape });
      const hero = `${device.name}, ${scheme}: the hero (${JSON.stringify(shape)})`;
      if (device.hero === "compact") {
        expect.soft(shape.headlinePx, `${hero} has the compact 32px headline`).toBe(32);
        expect.soft(shape.description, `${hero} shows only the description's first clause`).not.toContain(REST_OF_DESCRIPTION);
      } else {
        expect.soft(shape.headlinePx, `${hero} has a headline of 36px or more`).toBeGreaterThanOrEqual(36);
        expect.soft(shape.description, `${hero} shows the whole description`).toContain(REST_OF_DESCRIPTION);
        // 70% of the screen, up to 56rem: the page's short content then ends near the screen's foot.
        expect.soft(shape.heroHeight, `${hero} fills 70% of the screen`).toBeGreaterThanOrEqual(Math.min(0.7 * shape.viewportHeight, 896) - 1);
      }
      for (const { action, box, usableBottom, viewportWidth, covered, label, fallbackFont } of placements) {
        const where = `${device.name}, ${scheme}: "${action}" (top ${box.top}, bottom ${box.bottom}, usable to ${usableBottom})`;
        expect.soft(box.top, `${where} starts on screen`).toBeGreaterThanOrEqual(0);
        expect.soft(box.bottom, `${where} ends above the bottom safe area`).toBeLessThanOrEqual(usableBottom);
        expect.soft(box.left, `${where} starts inside the left edge`).toBeGreaterThanOrEqual(0);
        expect.soft(box.right, `${where} ends inside the right edge`).toBeLessThanOrEqual(viewportWidth);
        expect.soft(covered, `${where}: what covers it`).toEqual([]);
        expect.soft(label.left, `${where}: its label starts inside its border (at ${label.innerLeft})`).toBeGreaterThanOrEqual(label.innerLeft);
        expect.soft(label.right, `${where}: its label ends inside its border (at ${label.innerRight})`).toBeLessThanOrEqual(label.innerRight);
        expect.soft(fallbackFont, `${where}: text measured in a fallback font`).toEqual([]);
      }
    }
  } finally {
    await testInfo.attach(`landing-first-screen-${scheme}.json`, { body: JSON.stringify(results, null, 2), contentType: "application/json" });
  }
}

test.describe("Signed-out landing hero on a phone's or tablet's first screen", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("every hero action is on screen and uncovered at page load in the light theme", async ({ browser }, testInfo) => {
    await everyActionOnFirstScreen(browser, testInfo, "light");
  });

  test("every hero action is on screen and uncovered at page load in the dark theme", async ({ browser }, testInfo) => {
    await everyActionOnFirstScreen(browser, testInfo, "dark");
  });
});
