// The signed-out landing hero is readable (read-only, signed out, both themes). Its eyebrow,
// heading, description and three actions sit on a food photo under a dark gradient, so their
// contrast depends on the photo, not just the theme's tokens. "Log in" and "Search Recipes" used to
// be outline buttons with the page's dark ink and border on that dark photo, and on a phone the tab
// bar looked to sit over "Search Recipes" (a full-page capture), so coverage is checked too.
//
// For each piece of hero text and each action, this measures the contrast of the text against the
// pixels actually painted behind it (support/readability.ts), at rest and, for the actions, on
// hover, pressed and with keyboard focus; checks the focus outline against what it is drawn over;
// and checks that nothing covers an action once it is scrolled into view or focused. The theme is
// an explicit choice stored the way the theme toggle stores it, set against the opposite system
// setting, so the stored choice is what the page must follow.
import type { Locator, Page, TestInfo } from "@playwright/test";
import { THEME_STORAGE_KEY } from "../../app/lib/client-storage-schema";
import { test, expect } from "./support/journey";
import { waitForHydration } from "./support/navigation";
import {
  MIN_GLYPH_PIXELS,
  NON_TEXT_CONTRAST,
  coveringElements,
  measureFocusIndicator,
  measureTextContrast,
  type FocusIndicator,
  type TextContrast,
} from "./support/readability";

type Scheme = "light" | "dark";

interface Measurements {
  text: TextContrast[];
  focus: FocusIndicator[];
  covered: Array<{ what: string; covered: string[] }>;
}

async function openLanding(page: Page, scheme: Scheme): Promise<void> {
  await page.addInitScript(({ key, choice }) => {
    localStorage.setItem(key, choice);
  }, { key: THEME_STORAGE_KEY, choice: scheme });
  await page.emulateMedia({ colorScheme: scheme === "dark" ? "light" : "dark" });
  await page.goto("/");
  await waitForHydration(page);
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark")), "the page shows the stored theme").toBe(scheme === "dark");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), "the page's color-scheme").toBe(scheme);

  // The measurements need the real typeface and the decoded photo under the text.
  // measureTextContrast also fails any text whose own web font isn't loaded.
  expect(await page.evaluate(async () => (await document.fonts.ready).status), "web fonts").toBe("loaded");
  const photo = page.getByRole("img", { name: "Dinner table with shared dishes" });
  await expect(photo).toBeVisible();
  await photo.evaluate((image) => (image as HTMLImageElement).decode());
  expect(await photo.evaluate((image) => (image as HTMLImageElement).naturalWidth), "the hero photo's width").toBeGreaterThan(0);
}

function recordText(measurements: Measurements, result: TextContrast): void {
  measurements.text.push(result);
  expect
    .soft(result.minimum, `${result.label}: worst contrast ${result.minimum.toFixed(3)}:1 against ${result.worstBackground} (text ${result.textColor}, needs ${result.required}:1)`)
    .toBeGreaterThanOrEqual(result.required);
  expect
    .soft(result.fewestGlyphPixels, `${result.label}: pixels painted in the text colour on its emptiest line (nothing may cover the glyphs)`)
    .toBeGreaterThanOrEqual(MIN_GLYPH_PIXELS);
}

async function matches(locator: Locator, selector: string): Promise<boolean> {
  return locator.evaluate((element, state) => element.matches(state), selector);
}

async function recordCovered(measurements: Measurements, locator: Locator, what: string): Promise<void> {
  const covered = await coveringElements(locator);
  measurements.covered.push({ what, covered });
  expect.soft(covered, `${what}: what covers it`).toEqual([]);
}

async function checkHeroText(page: Page, measurements: Measurements, locator: Locator, name: string): Promise<void> {
  await locator.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await recordCovered(measurements, locator, `${name}, scrolled into view`);
  recordText(measurements, await measureTextContrast(page, locator, name));
}

async function checkAction(page: Page, measurements: Measurements, action: Locator, name: string): Promise<void> {
  await test.step(`${name} is readable at rest, on hover and pressed, and nothing covers it`, async () => {
    await page.mouse.move(0, 0);
    await action.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await recordCovered(measurements, action, `${name}, scrolled into view`);
    recordText(measurements, await measureTextContrast(page, action, `${name} at rest`));

    await action.hover();
    expect(await matches(action, ":hover"), `${name} is hovered`).toBe(true);
    recordText(measurements, await measureTextContrast(page, action, `${name} on hover`));

    // Press without activating: release away from the link.
    await page.mouse.down();
    try {
      expect(await matches(action, ":active"), `${name} is pressed`).toBe(true);
      recordText(measurements, await measureTextContrast(page, action, `${name} pressed`));
    } finally {
      await page.mouse.move(0, 0);
      await page.mouse.up();
    }
  });

  await test.step(`${name} shows a visible focus outline, stays readable and uncovered when focused from the top of the page`, async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    // A key press first, so the browser treats the focus that follows as keyboard focus.
    await page.keyboard.press("Tab");
    await action.focus();
    await expect(action).toBeFocused();
    await recordCovered(measurements, action, `${name}, focused`);
    recordText(measurements, await measureTextContrast(page, action, `${name} focused`));
    const ring = await measureFocusIndicator(page, action, name);
    measurements.focus.push(ring);
    expect.soft(ring.focusVisible, `${name} matches :focus-visible`).toBe(true);
    expect.soft(ring.outlineStyle, `${name}'s focus outline style`).not.toBe("none");
    expect.soft(ring.outlineWidth, `${name}'s focus outline width`).toBeGreaterThanOrEqual(2);
    expect
      .soft(ring.minimum, `${name}'s focus outline (${ring.outlineColor}): worst contrast ${ring.minimum.toFixed(3)}:1 against what it covers, needs ${NON_TEXT_CONTRAST}:1`)
      .toBeGreaterThanOrEqual(NON_TEXT_CONTRAST);
    await action.blur();
  });
}

async function heroIsReadable(page: Page, testInfo: TestInfo, scheme: Scheme): Promise<void> {
  const measurements: Measurements = { text: [], focus: [], covered: [] };
  try {
    await openLanding(page, scheme);
    await testInfo.attach(`landing-${scheme}-top`, { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" });

    const heading = page.getByRole("heading", { level: 1, name: "Your food should look as good as it tastes." });
    const hero = page.locator("section").filter({ has: heading });
    await test.step("the eyebrow, heading and description read against the photo", async () => {
      await checkHeroText(page, measurements, hero.getByText("The Recipe App", { exact: true }), "Eyebrow");
      await checkHeroText(page, measurements, heading, "Heading");
      await checkHeroText(page, measurements, hero.getByText(/^Spoonjoy is a photo-first kitchen/), "Description");
    });

    await checkAction(page, measurements, hero.getByRole("link", { name: "Start Your Kitchen", exact: true }), "Start Your Kitchen");
    await checkAction(page, measurements, hero.getByRole("link", { name: "Log in", exact: true }), "Log in");
    await checkAction(page, measurements, hero.getByRole("link", { name: "Search Recipes", exact: true }), "Search Recipes");
  } finally {
    await testInfo.attach(`landing-${scheme}-readability.json`, {
      body: JSON.stringify(measurements, null, 2),
      contentType: "application/json",
    });
  }
}

test.describe("Signed-out landing hero readability", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("every hero text and action is readable in the light theme", async ({ page }, testInfo) => {
    await heroIsReadable(page, testInfo, "light");
  });

  test("every hero text and action is readable in the dark theme", async ({ page }, testInfo) => {
    await heroIsReadable(page, testInfo, "dark");
  });
});
