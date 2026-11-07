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
//
// A phone held sideways is wide but under 480 tall, so the width rules alone gave it the desktop hero:
// a 60px headline with the actions under the tab bar, past the first screen. It gets the sideways
// hero instead: the photo fills the screen below the header, and the 32px headline, the
// description's first clause and the actions on one row sit above the tab bar. Playwright's
// "landscape" iPhones leave out Safari's bars and the notch's side margins; the full-screen
// entries are the same phones with the whole screen, as when Safari hides its bars. The Duo's outer
// screen sideways swaps its measured 382 x 531 page. Under 336 tall (the 13 mini's Safari page, the
// first iPhone SE's whole 568 x 320 screen) the headline drops to 24px, one line from 568 wide.
//
// A visitor who started a recipe while signed out has it listed in this browser, and the Cooking now
// strip appears after hydration. It follows the hero, so the hero's actions keep their place on the
// first screen, and its own Back to action is uncovered once scrolled into view. Opened at
// /#cooking-now (the Cooking pill's link), the page brings the strip into view once it appears.
import { devices, type Browser, type BrowserContextOptions, type TestInfo } from "@playwright/test";
import { THEME_STORAGE_KEY } from "../../app/lib/client-storage-schema";
import { COOKING_NOW_LOCAL_STORAGE_KEY } from "../../app/lib/cooking-now";
import { test, expect, appendConsoleIssues, assertNoConsoleIssues, watchConsole } from "./support/journey";
import { waitForHydrationOnLoad } from "./support/app-ready";
import { waitForHydration } from "./support/navigation";
import { coveringElements } from "./support/readability";

type Scheme = "light" | "dark";

/** Compact: a 32px headline and the description's first clause. Roomy: a 36px headline or larger and
 * the whole description. Sideways: the compact headline and clause, the actions on one row, and the
 * photo down to the foot of the screen; low sideways is the same with a 24px headline. */
type Hero = "compact" | "roomy" | "sideways" | "low sideways";

interface Phone {
  name: string;
  context: BrowserContextOptions;
  hero: Hero;
  /** Whether this browser has a recipe in progress, so the Cooking now strip shows. */
  cookingNow?: boolean;
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

// The smallest phone that gets the roomy hero, where its actions have the least room to spare.
const SMALLEST_ROOMY: Phone = {
  name: "Smallest roomy phone, 360 x 600",
  context: { ...devices["iPhone 15"], viewport: { width: 360, height: 600 } },
  hero: "roomy",
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

/** A landscape iPhone with the whole screen for the page. */
function fullScreen(name: string, width: number, height: number): Phone {
  return { name: `${name}, full screen`, context: { ...devices[name], viewport: { width, height } }, hero: "sideways" };
}

const DUO_SIDEWAYS: Phone = {
  name: "iPhone Duo, one screen, sideways",
  context: {
    ...devices["iPhone 15 landscape"],
    viewport: { width: 531, height: 382 },
    screen: { width: 678, height: 466 },
  },
  hero: "sideways",
};

const UPRIGHT: Phone[] = [
  phone("iPhone SE", "compact"),
  phone("iPhone 13 Mini", "roomy"),
  phone("iPhone 15", "roomy"),
  phone("iPhone 15 Pro Max", "roomy"),
  SMALLEST_ROOMY,
  DUO_SCREEN,
  DUO_OPEN,
  phone("iPad Pro 11", "roomy"),
];

const SIDEWAYS: Phone[] = [
  phone("iPhone 15 Pro Max landscape", "sideways"),
  phone("iPhone 15 landscape", "sideways"),
  phone("iPhone 13 Mini landscape", "low sideways"),
  phone("iPhone SE (3rd gen) landscape", "sideways"),
  phone("iPhone SE landscape", "low sideways"),
  fullScreen("iPhone 15 Pro Max landscape", 932, 430),
  fullScreen("iPhone 15 landscape", 852, 393),
  DUO_SIDEWAYS,
];

const COOKING: Phone[] = [
  { ...phone("iPhone 15", "roomy"), name: "iPhone 15, a recipe in progress", cookingNow: true },
  { ...phone("iPhone 15 landscape", "sideways"), name: "iPhone 15 landscape, a recipe in progress", cookingNow: true },
];

/** QA's Lemon Herb Rice, one of five ingredients checked a moment ago, as the recipe page stores it. */
const LEMON_RICE = "qa-kitchen-recipe-lemon-rice";

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
  heroBottom: number;
  viewportHeight: number;
}

interface Strip {
  /** What covers Back to Lemon Herb Rice once it is scrolled into view. */
  backTo: string[];
  /** Where the strip's top sits on the screen after the page is opened at /#cooking-now. */
  topFromLink: number;
}

async function firstScreen(browser: Browser, testInfo: TestInfo, device: Phone, scheme: Scheme): Promise<{ placements: Placement[]; shape: HeroShape; strip: Strip | null }> {
  const context = await browser.newContext({ ...device.context, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  waitForHydrationOnLoad(page);
  const watcher = watchConsole(page);
  const placements: Placement[] = [];
  let shape: HeroShape | undefined;
  let strip: Strip | null = null;
  try {
    await page.addInitScript(({ key, choice }) => {
      localStorage.setItem(key, choice);
    }, { key: THEME_STORAGE_KEY, choice: scheme });
    if (device.cookingNow) {
      await page.addInitScript(({ key, id }) => {
        localStorage.setItem(key, JSON.stringify({ [id]: {
          recipe: { id, title: "Lemon Herb Rice", coverImageUrl: null }, listed: true, activeStepId: null, activeStepIndex: 0,
          stepCount: 3, checkedCount: 1, totalCount: 5, allCheckedAt: null, touchedAt: Date.now(), progressKey: "journey" } }));
      }, { key: COOKING_NOW_LOCAL_STORAGE_KEY, id: LEMON_RICE });
    }
    await page.goto("/");
    await waitForHydration(page);
    // The strip is read from this browser after hydration; measure once it is in place.
    if (device.cookingNow) await page.getByTestId("local-cooking-now").waitFor();
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
      heroBottom: await hero.evaluate((element) => element.getBoundingClientRect().bottom),
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
    if (device.cookingNow) {
      const back = page.getByRole("link", { name: "Back to Lemon Herb Rice", exact: true });
      await back.evaluate((element) => element.scrollIntoView({ block: "center" }));
      const backTo = await coveringElements(back);
      // A fresh load at the pill's link: the strip is not in the server's page, so the router finds no
      // #cooking-now to scroll to; the strip brings itself into view once it appears.
      // A query makes it a new page load rather than a jump within this one.
      await page.goto("/?from=pill#cooking-now");
      await waitForHydration(page);
      await page.getByTestId("local-cooking-now").waitFor();
      await page.waitForFunction(() => {
        const top = document.getElementById("cooking-now")?.getBoundingClientRect().top ?? -1;
        return top >= 0 && top < window.innerHeight;
      }, undefined, { timeout: 5_000 }).catch(() => undefined);
      const topFromLink = await page.locator("#cooking-now").evaluate((element) => element.getBoundingClientRect().top);
      strip = { backTo, topFromLink };
    }
  } catch (error) {
    throw appendConsoleIssues(error, watcher.issues);
  } finally {
    watcher.dispose();
    await context.close();
  }
  assertNoConsoleIssues(watcher.issues);
  return { placements, shape: shape!, strip };
}

async function everyActionOnFirstScreen(browser: Browser, testInfo: TestInfo, phones: Phone[], scheme: Scheme): Promise<void> {
  const results: Array<{ phone: string; placements: Placement[]; shape: HeroShape; strip: Strip | null }> = [];
  try {
    for (const device of phones) {
      const { placements, shape, strip } = await firstScreen(browser, testInfo, device, scheme);
      results.push({ phone: device.name, placements, shape, strip });
      expect.soft(strip === null, `${device.name}, ${scheme}: the Cooking now strip shows only with a recipe in progress`).toBe(!device.cookingNow);
      expect.soft(strip?.backTo ?? [], `${device.name}, ${scheme}: what covers Back to Lemon Herb Rice once scrolled into view`).toEqual([]);
      const linkTop = strip?.topFromLink ?? 0;
      expect.soft(linkTop, `${device.name}, ${scheme}: opened at /#cooking-now, the strip's top is on screen`).toBeGreaterThanOrEqual(0);
      expect.soft(linkTop, `${device.name}, ${scheme}: opened at /#cooking-now, the strip's top is on screen`).toBeLessThan(shape.viewportHeight);
      const hero = `${device.name}, ${scheme}: the hero (${JSON.stringify(shape)})`;
      if (device.hero === "compact") {
        expect.soft(shape.headlinePx, `${hero} has the compact 32px headline`).toBe(32);
        expect.soft(shape.description, `${hero} shows only the description's first clause`).not.toContain(REST_OF_DESCRIPTION);
      } else if (device.hero === "sideways" || device.hero === "low sideways") {
        expect.soft(shape.headlinePx, `${hero} has the ${device.hero === "sideways" ? "compact 32px" : "low 24px"} headline`).toBe(device.hero === "sideways" ? 32 : 24);
        expect.soft(shape.description, `${hero} shows only the description's first clause`).not.toContain(REST_OF_DESCRIPTION);
        expect.soft(shape.heroBottom, `${hero}: the photo reaches the foot of the screen`).toBeGreaterThanOrEqual(shape.viewportHeight - 1);
        const tops = placements.map(({ box }) => Math.round(box.top));
        expect.soft(new Set(tops).size, `${hero}: the actions share one row (tops ${tops.join(", ")})`).toBe(1);
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
    await everyActionOnFirstScreen(browser, testInfo, UPRIGHT, "light");
  });

  test("every hero action is on screen and uncovered at page load in the dark theme", async ({ browser }, testInfo) => {
    await everyActionOnFirstScreen(browser, testInfo, UPRIGHT, "dark");
  });

  test("every hero action is on screen and uncovered at page load on a phone held sideways in the light theme", async ({ browser }, testInfo) => {
    await everyActionOnFirstScreen(browser, testInfo, SIDEWAYS, "light");
  });

  test("every hero action is on screen and uncovered at page load on a phone held sideways in the dark theme", async ({ browser }, testInfo) => {
    await everyActionOnFirstScreen(browser, testInfo, SIDEWAYS, "dark");
  });

  test("every hero action is on screen and uncovered with a recipe in progress in the light theme", async ({ browser }, testInfo) => {
    await everyActionOnFirstScreen(browser, testInfo, COOKING, "light");
  });

  test("every hero action is on screen and uncovered with a recipe in progress in the dark theme", async ({ browser }, testInfo) => {
    await everyActionOnFirstScreen(browser, testInfo, COOKING, "dark");
  });
});
