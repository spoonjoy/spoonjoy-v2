// CAPTURE-ONLY. Lives on capture branches that never merge. It records before/after screenshots
// for root review of #463 (no "No ingredients added yet" under a parsed list, with #386 merged in) on this run's own disposable QA stack. Run stacks
// have no OpenAI or image-generation key, so AI parsing is off and every regeneration fails.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { test, expect } from "./support/journey";
import { waitForHydration } from "./support/navigation";
import { scratchStorageStatePath } from "./support/personas";

type Mode = { name: string; width: number; height: number; colorScheme: "light" | "dark" };
const MOBILE_MODES: Mode[] = [
  { name: "390-light", width: 390, height: 844, colorScheme: "light" },
  { name: "390-dark", width: 390, height: 844, colorScheme: "dark" },
];
const RECIPE_URL = /\/recipes\/(?!new$)[^/?#]+$/;
const LABEL = process.env.CAPTURE_LABEL ?? "unlabelled";

async function open(browser: Browser, mode: Mode): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    storageState: scratchStorageStatePath(1),
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

async function createRecipe(browser: Browser, title: string): Promise<string> {
  const { context, page } = await open(browser, MOBILE_MODES[0]);
  await page.goto("/recipes/new");
  await waitForHydration(page);
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Add Step", exact: true }).click();
  const card = page.getByRole("article", { name: "Step 1", exact: true });
  await card.getByLabel("Instructions").fill("Bring a large pot of water to a boil");
  await card.getByRole("switch", { name: "AI Parse" }).setChecked(false);
  await card.getByLabel("Quantity").fill("4");
  await card.getByLabel("Unit").fill("quart");
  await card.getByLabel("Ingredient", { exact: true }).fill("water");
  await card.getByRole("button", { name: "Add ingredient" }).click();
  await expect(card.getByRole("button", { name: "Remove water" })).toBeVisible();
  await page.getByRole("button", { name: "Create Recipe", exact: true }).click();
  await expect(page).toHaveURL(RECIPE_URL);
  const recipePath = new URL(page.url()).pathname;
  await context.close();
  return recipePath;
}

test.describe("capture @capture", () => {
  test("Add Step page parses typed ingredients with AI parsing unavailable @capture", async ({ browser }, testInfo) => {
    test.setTimeout(240_000);
    const recipePath = await createRecipe(browser, `Capture Pasta ${Date.now().toString(36)}`);
    const shoot = async (mode: Mode) => {
      const { context, page } = await open(browser, mode);
      await page.goto(`${recipePath}/steps/new`);
      await waitForHydration(page);
      await page.getByRole("textbox", { name: "Description *" }).fill("Boil the pasta in salted water");
      const parseResponse = page.waitForResponse(
        (response) => response.request().method() === "POST" && new URL(response.url()).pathname.startsWith(`${recipePath}/steps/new`),
      );
      await page.getByRole("textbox", { name: "Ingredient text" }).fill("1 lb spaghetti\n2 tbsp kosher salt\n3 cloves garlic, minced");
      await parseResponse;
      await expect(
        page.getByRole("button", { name: "Remove spaghetti" }).or(page.getByRole("alert")).first(),
      ).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(500);
      await save(testInfo, `386-add-step-${mode.name}`, await page.screenshot({ fullPage: true }));
      await context.close();
    };
    await shoot(MOBILE_MODES[0]);
    await shoot(MOBILE_MODES[1]);
  });
});
