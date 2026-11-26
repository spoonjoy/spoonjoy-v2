// The public page on running Spoonjoy yourself (signed out, read-only), on a phone and a desktop: the
// page never scrolls sideways, each code line stays whole (a long one scrolls inside its block on a
// phone rather than wrapping), its sections use the page's full width, and its
// notice and code blocks have Ouro's squircle corners. The page is static, so a reload shows the same.
import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "./support/journey";
import { expectNoHydrationErrors } from "./support/hydration";
import { waitForHydration } from "./support/navigation";

async function expectSelfHostPage(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 1, name: "Run Spoonjoy on your own server", exact: true })).toBeVisible();
  for (const section of ["Start it", "What the first account gets", "Update it"]) {
    await expect(page.getByRole("heading", { level: 2, name: section, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Start it", exact: true })).toContainText("context: https://github.com/spoonjoy/spoonjoy-v2.git#main");
}

/**
 * The page is no wider than the window. Code never wraps: each block keeps white-space: pre and shows
 * one row per line of its code, so a long line scrolls inside its block instead of breaking in two.
 */
async function expectWholeCodeLines(page: Page): Promise<void> {
  const layout = await page.evaluate(() => ({
    pageOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    blocks: [...document.querySelectorAll("main [data-ouro-part=code]")].map((pre) => {
      const code = pre.querySelector("code")!;
      const lineHeight = parseFloat(getComputedStyle(pre).lineHeight);
      return {
        whiteSpace: getComputedStyle(pre).whiteSpace,
        lines: (code.textContent ?? "").replace(/\n$/, "").split("\n").length,
        rows: Math.round(code.getBoundingClientRect().height / lineHeight),
      };
    }),
  }));
  expect(layout.pageOverflows).toBe(false);
  expect(layout.blocks).toHaveLength(3);
  for (const block of layout.blocks) {
    expect(block.whiteSpace).toBe("pre");
    expect(block.rows).toBe(block.lines);
  }
}

/**
 * The sections are as wide as the page header, and the intro fills the header's text column (all but
 * the small gap the header keeps for actions), so no text measure narrows either.
 */
async function expectFullWidth(page: Page): Promise<void> {
  const header = await page.locator("main [data-ouro=page-header]").boundingBox();
  const intro = await page.locator("main [data-ouro=page-header] [data-slot=description]").boundingBox();
  const start = await page.getByRole("region", { name: "Start it", exact: true }).boundingBox();
  expect(header && intro && start).toBeTruthy();
  expect(intro!.width).toBeGreaterThanOrEqual(header!.width - 24);
  expect(Math.abs(start!.width - header!.width)).toBeLessThanOrEqual(1);
}

/** The notice and the code blocks take Ouro's corner shape, a squircle. */
async function expectSquircles(page: Page): Promise<void> {
  const shapes = await page.evaluate(() =>
    [...document.querySelectorAll("main [data-ouro=alert], main [data-ouro=code-block]")].map((el) => getComputedStyle(el).getPropertyValue("--corner-shape").trim()),
  );
  expect(shapes.length).toBe(4);
  expect(new Set(shapes)).toEqual(new Set(["squircle"]));
}

async function savePageScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}-${testInfo.project.name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

test.describe("Self-host page, signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a visitor reads how to start, set up and update their own server, and it is the same after a reload", async ({ page, expectAccessible }, testInfo) => {
    await page.goto("/self-host");
    await waitForHydration(page);
    await expectNoHydrationErrors(page);
    await expectSelfHostPage(page);
    await expectWholeCodeLines(page);
    await expectFullWidth(page);
    await expectSquircles(page);
    await expectAccessible();
    await savePageScreenshot(page, testInfo, "self-host");

    await page.reload();
    await waitForHydration(page);
    await expectSelfHostPage(page);
  });
});
