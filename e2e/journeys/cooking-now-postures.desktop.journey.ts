// The recipe page as a cookbook spread, and the signed-out Cooking now strip and its Back to card, at every
// window shape a cook uses: a phone, the iPhone Duo closed, open tall (fold across the middle),
// open like a book (fold down the middle), one half of a Split View, and a desktop window. Each
// shape is its own browser context, and every screenshot goes into the journeys-report artifact.
//
// Signed out, so progress lives in this browser and no account changes: checking an ingredient
// marks the current step and puts Lemon Herb Rice on this browser's Cooking now list. The Duo is
// recognised from a coarse pointer and its 669 x 951 inner screen (app/lib/fold.ts), so the open
// postures emulate a touch screen of that size. The closed outer screen's size is not published;
// 402 x 874 stands in for it. Desktop Chrome only: each test builds its own devices.
import { test, expect, appendConsoleIssues, assertNoConsoleIssues, watchConsole } from "./support/journey";
import { waitForHydrationOnLoad } from "./support/app-ready";
import type { Browser, BrowserContextOptions, Page, TestInfo } from "@playwright/test";
import { expectNoHydrationErrors } from "./support/hydration";
import { waitForHydration } from "./support/navigation";

const LEMON_RICE = "/recipes/qa-kitchen-recipe-lemon-rice";

interface Posture {
  name: string;
  context: BrowserContextOptions;
  /** What app/lib/fold.ts should mark `<html data-fold>` with. */
  fold: "vertical" | "horizontal" | "none";
  /** Whether each step lays out as a spread: ingredients on the left page, the method on the right. */
  spread: boolean;
}

function touch(width: number, height: number, screen = { width, height }): BrowserContextOptions {
  return { viewport: { width, height }, screen, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
}

const DUO_TALL = { width: 669, height: 951 };
const DUO_BOOK = { width: 951, height: 669 };

const PHONE: Posture = { name: "phone", context: touch(393, 852), fold: "none", spread: false };
const DUO_CLOSED: Posture = { name: "duo-closed", context: touch(402, 874), fold: "none", spread: false };
const DUO_OPEN_PORTRAIT: Posture = { name: "duo-open-portrait", context: touch(669, 951, DUO_TALL), fold: "horizontal", spread: false };
const DUO_OPEN_LANDSCAPE: Posture = { name: "duo-open-landscape", context: touch(951, 669, DUO_BOOK), fold: "vertical", spread: true };
// Half of the open Duo held like a book: compact width, no fold crossing the window.
const DUO_SPLIT_VIEW_HALF: Posture = { name: "duo-split-view-half", context: touch(475, 669, DUO_BOOK), fold: "none", spread: false };
const DESKTOP: Posture = { name: "desktop", context: { viewport: { width: 1440, height: 900 } }, fold: "none", spread: true };

async function save(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

/**
 * Waits for the checklist to finish drawing the tick and the strike (HX Checklist's transitions),
 * then checks that no two rows of any step's ingredient list overlap, so a screenshot never shows
 * the list mid-change.
 */
async function expectIngredientRowsSettled(page: Page) {
  const lists = page.locator(".sj-step-ingredients [data-ouro-checklist-rows]");
  await expect.poll(() => lists.evaluateAll((elements) => elements.every((element) =>
    element.getAnimations({ subtree: true }).every((animation) => animation.playState !== "running"))))
    .toBe(true);
  const overlaps = await lists.evaluateAll((elements) => elements.flatMap((list) => {
    const boxes = Array.from(list.children, (row) => row.getBoundingClientRect()).filter((box) => box.height > 0);
    return boxes.slice(1).flatMap((box, index) => (box.top < boxes[index].bottom - 0.5
      ? [`row ${index + 2} starts at ${box.top}, above row ${index + 1}'s end at ${boxes[index].bottom}`]
      : []));
  }));
  expect(overlaps).toEqual([]);
}

async function photograph(browser: Browser, testInfo: TestInfo, posture: Posture) {
  const context = await browser.newContext({ ...posture.context, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  waitForHydrationOnLoad(page);
  const watcher = watchConsole(page);
  try {
    await page.goto(LEMON_RICE);
    await waitForHydration(page);
    await expect(page.getByRole("heading", { level: 1, name: "Lemon Herb Rice", exact: true })).toBeVisible();
    await expectNoHydrationErrors(page);
    await expect(page.locator("html")).toHaveAttribute("data-fold", posture.fold);

    // Jasmine rice is the first ingredient.
    await page.getByRole("checkbox", { name: "jasmine rice", exact: true }).click();
    const firstStep = page.locator("[data-current-step]");
    await expect(firstStep.getByTestId("current-step-marker")).toHaveText("You are here");
    await expectIngredientRowsSettled(page);
    // Viewport screenshots only: a full-page screenshot resizes the window to the page's height, which
    // turns the book-held Duo into a tall window with no fold.
    await save(page, testInfo, `recipe-${posture.name}`);
    await page.locator("#steps").evaluate((element) => element.scrollIntoView({ block: "start" }));
    await expect.poll(() => firstStep.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length))
      .toBe(posture.spread ? 2 : 1);
    // The steps clear the sticky desktop header instead of sliding under it.
    const headerBottom = await page.locator(".sj-desktop-topbar").evaluate((header) => (getComputedStyle(header).display === "none" ? 0 : header.getBoundingClientRect().bottom));
    await expect.poll(() => page.locator("#steps").evaluate((steps) => steps.getBoundingClientRect().top)).toBeGreaterThanOrEqual(headerBottom);
    await expectIngredientRowsSettled(page);
    await save(page, testInfo, `recipe-steps-${posture.name}`);

    // The landing page lists the recipe this browser is cooking, with Back to it.
    await page.goto("/");
    await waitForHydration(page);
    await expect(page.getByRole("link", { name: "Back to Lemon Herb Rice", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Cooking now" }).getByRole("article")).toHaveCount(1);
    await expect(page.getByTestId("cooking-now-hero")).toHaveAccessibleName("Lemon Herb Rice");
    await expect(page.getByTestId("cooking-now-cover-placeholder")).toHaveText("L");
    await save(page, testInfo, `kitchen-${posture.name}`);
  } catch (error) {
    throw appendConsoleIssues(error, watcher.issues);
  } finally {
    watcher.dispose();
    await context.close();
  }
  assertNoConsoleIssues(watcher.issues);
}

test.describe("Cooking now at every window shape", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a phone and the Duo closed show one column", async ({ browser }, testInfo) => {
    await photograph(browser, testInfo, PHONE);
    await photograph(browser, testInfo, DUO_CLOSED);
  });

  test("the open Duo shows a spread held like a book and one column held tall", async ({ browser }, testInfo) => {
    await photograph(browser, testInfo, DUO_OPEN_LANDSCAPE);
    await photograph(browser, testInfo, DUO_OPEN_PORTRAIT);
  });

  test("half of a Split View is a phone layout and a desktop window is a spread", async ({ browser }, testInfo) => {
    await photograph(browser, testInfo, DUO_SPLIT_VIEW_HALF);
    await photograph(browser, testInfo, DESKTOP);
  });
});
