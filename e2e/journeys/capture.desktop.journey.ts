// CAPTURE-ONLY. Lives on capture branches that never merge. It records before/after screenshots
// of the "Skip to main content" link for root review: a full-page capture of a scrolled page with
// the link unfocused (it must not show), and the viewport with the link focused (it must show at
// the top-left corner).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { test, expect } from "./support/journey";
import { waitForHydration } from "./support/navigation";
import { personaStorageStatePath } from "./support/personas";

type Mode = { name: string; width: number; height: number; colorScheme: "light" | "dark" };
const MODES: Mode[] = [
  { name: "390-light", width: 390, height: 844, colorScheme: "light" },
  { name: "390-dark", width: 390, height: 844, colorScheme: "dark" },
  { name: "1280-light", width: 1280, height: 800, colorScheme: "light" },
];
const LABEL = process.env.CAPTURE_LABEL ?? "unlabelled";

async function open(browser: Browser, mode: Mode): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    storageState: personaStorageStatePath("chef"),
    viewport: { width: mode.width, height: mode.height },
    colorScheme: mode.colorScheme,
    baseURL: process.env.SPOONJOY_JOURNEYS_BASE_URL,
  });
  await context.addInitScript((theme) => {
    try {
      window.localStorage.setItem("spoonjoy-theme", theme);
    } catch {
      // Ignore storage failures; prefers-color-scheme is emulated as well.
    }
  }, mode.colorScheme);
  return { context, page: await context.newPage() };
}

async function save(testInfo: TestInfo, name: string, body: Buffer) {
  const file = `${LABEL}-${name}.png`;
  const dir = path.join("test-results", "captures");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, file), body);
  await testInfo.attach(file, { body, contentType: "image/png" });
}

test("skip link captures @capture", async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  for (const mode of MODES) {
    const { context, page } = await open(browser, mode);
    await page.goto("/recipes");
    await waitForHydration(page);
    const link = page.getByRole("link", { name: "Skip to main content" });
    await page.evaluate(() => window.scrollTo(0, Math.floor(document.documentElement.scrollHeight / 3)));
    await expect(link).not.toBeFocused();
    await save(testInfo, `scrolled-unfocused-fullpage-${mode.name}`, await page.screenshot({ fullPage: true }));
    await page.evaluate(() => window.scrollTo(0, 0));
    await link.focus();
    await expect(link).toBeFocused();
    await save(testInfo, `focused-${mode.name}`, await page.screenshot());
    await context.close();
  }
});
