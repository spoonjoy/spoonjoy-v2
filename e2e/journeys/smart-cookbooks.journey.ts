// Smart cookbooks (smart-cookbooks flag, on in QA), as per-run scratch user 1, whose area is recipe editing: a cook
// tags two recipes Quick from their Organize pages and gives one of them a tool, then makes a smart cookbook from
// Cookbooks with Quick and without the tool. The cookbook's page lists the one Quick recipe without the tool and not
// the other, after a reload, and Cookbooks lists the cookbook with its rules; then the cook renames it and deletes it
// from its page, each after a reload, and the salad stays theirs. Both device projects run at the same
// time as the same scratch user, so every recipe, organizer and cookbook carries the project name and a timestamp.
import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "./support/journey";
import { chooseMenuItem } from "./support/menu";
import { pathUrl, waitForHydration } from "./support/navigation";
import { scratchStorageStatePath } from "./support/personas";
import { requiredLabel } from "./support/forms";
import { expectLastRowClearsTabBar } from "./support/tab-bar-clearance";
import { addNewToken, addSuggestedToken, attachElementShot, pickToken } from "./support/organize-tokens";

const RECIPE_URL = /\/recipes\/(?!new$)[^/?#]+$/;
const SMART_URL = /\/cookbooks\/smart\/(?!new$)[^/?#]+$/;

/** Makes a recipe with only a title and opens its Organize page. */
async function newRecipeToOrganize(page: Page, title: string): Promise<void> {
  await page.goto("/recipes/new", { waitUntil: "commit" });
  const titleField = page.getByLabel(requiredLabel("Title"), { exact: true });
  await waitForHydration(page);
  await titleField.fill(title);
  await page.getByRole("button", { name: "Create recipe", exact: true }).click();
  await expect(page).toHaveURL(RECIPE_URL);
  const recipePath = new URL(page.url()).pathname;
  await waitForHydration(page);
  await chooseMenuItem(page, page.getByRole("button", { name: "Recipe actions", exact: true }), "Organize");
  await expect(page).toHaveURL(pathUrl(`${recipePath}/organize`));
  await waitForHydration(page);
}

async function save(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(`${name}-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true, animations: "disabled" }),
    contentType: "image/png",
  });
}

test.describe("Smart cookbooks", () => {
  test.use({ storageState: scratchStorageStatePath(1) });

  test("a cook makes a smart cookbook with one tag and without one tool, and it fills with the matching recipe after a reload @mutates", async ({ page, verifyAfterReload, expectAccessible }, testInfo) => {
    test.setTimeout(180_000);
    const phone = testInfo.project.name === "iphone-webkit";
    const suffix = `${testInfo.project.name} ${Date.now().toString(36)}`;
    const quick = `Quick ${suffix}`;
    const mixer = `Mixer ${suffix}`;
    const salad = `Journey Smart Salad ${suffix}`;
    const cake = `Journey Smart Cake ${suffix}`;
    const title = `Quick, no mixer ${suffix}`;

    // A salad tagged Quick, and a cake tagged Quick and made with the mixer.
    await newRecipeToOrganize(page, salad);
    await addNewToken(page, "Tags", quick, phone);
    await save(page);
    await newRecipeToOrganize(page, cake);
    await addSuggestedToken(page, "Tags", quick.toLowerCase(), quick, phone);
    await addNewToken(page, "Tools", mixer, phone);
    await save(page);

    // A smart cookbook from Cookbooks: with Quick, without the mixer.
    await page.goto("/cookbooks");
    await waitForHydration(page);
    await page.getByRole("link", { name: "New smart cookbook", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "New smart cookbook", exact: true })).toBeVisible();
    await waitForHydration(page);
    await page.getByLabel(requiredLabel("Title"), { exact: true }).fill(title);
    await pickToken(page, "With", quick, phone);
    await pickToken(page, "Without", mixer, phone);
    await attachElementShot(
      page.locator("form").filter({ has: page.getByRole("button", { name: "Create smart cookbook", exact: true }) }),
      testInfo,
      "smart-cookbook-form",
    );
    await page.getByRole("button", { name: "Create smart cookbook", exact: true }).click();
    await expect(page).toHaveURL(SMART_URL);

    // It fills itself, in the Contents a regular cookbook shows: the salad's card with its cover tile, counted as one
    // recipe, and not the cake, which has the mixer.
    const contents = page.getByRole("region", { name: "Contents", exact: true });
    const recipes = page.getByRole("list", { name: `Recipes in ${title}`, exact: true });
    await verifyAfterReload(async () => {
      await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: `Tag: ${quick}`, exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: `Tool: ${mixer}`, exact: true })).toBeVisible();
      await expect(contents.getByText("1 recipe", { exact: true })).toBeVisible();
      const card = recipes.getByRole("listitem").filter({ hasText: salad });
      await expect(card.getByRole("link", { name: new RegExp(salad) })).toBeVisible();
      await expect(card.locator('[data-testid^="cookbook-recipe-cover-placeholder-"], img')).toBeVisible();
      await expect(recipes.getByRole("link", { name: new RegExp(cake) })).toHaveCount(0);
    });
    await expectAccessible();
    await attachScreenshot(page, testInfo, "smart-cookbook-after-reload");
    // Scrolled to the end, the last recipe clears the phone's tab bar; the shot is the visible screen.
    await expectLastRowClearsTabBar(page, recipes.getByRole("listitem").last(), testInfo, "smart-cookbook-end-of-page");

    // Cookbooks lists it with its rules.
    await page.goto("/cookbooks");
    await waitForHydration(page);
    const smart = page.getByRole("list", { name: "Smart cookbooks", exact: true });
    await verifyAfterReload(async () => {
      await expect(smart.getByRole("listitem").filter({ hasText: title })).toContainText(`With ${quick} · Without ${mixer}`);
    });
    await attachElementShot(page.getByRole("region", { name: "Smart cookbooks", exact: true }), testInfo, "smart-cookbooks-list-after-reload");

    // Rename it from its page; the new title holds after a reload.
    const renamed = `Speedy, no mixer ${suffix}`;
    await smart.getByRole("link", { name: new RegExp(title) }).click();
    await expect(page).toHaveURL(SMART_URL);
    await waitForHydration(page);
    const rename = page.getByRole("form", { name: "Rename this cookbook", exact: true });
    await rename.getByRole("textbox", { name: "Title", exact: true }).fill(renamed);
    await rename.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: renamed, exact: true })).toBeVisible();
    await verifyAfterReload(async () => {
      await expect(page.getByRole("heading", { level: 1, name: renamed, exact: true })).toBeVisible();
      await expect(page.getByRole("list", { name: `Recipes in ${renamed}`, exact: true }).getByRole("link", { name: new RegExp(salad) })).toBeVisible();
    });
    await attachElementShot(page.getByRole("region", { name: "Change this cookbook", exact: true }), testInfo, "smart-cookbook-change-section");

    // Delete it after the dialog asks; Cookbooks no longer lists it, and the salad is still the cook's.
    await waitForHydration(page);
    await page.getByRole("button", { name: "Delete cookbook", exact: true }).click();
    const ask = page.getByRole("alertdialog", { name: `Delete ${renamed}?`, exact: true });
    await expect(ask).toBeVisible();
    await ask.getByRole("button", { name: "Delete it", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/cookbooks"));
    await verifyAfterReload(async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Cookbooks", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: new RegExp(renamed) })).toHaveCount(0);
    });
    await page.goto("/my-recipes");
    await expect(page.getByRole("list", { name: "My recipes", exact: true }).getByRole("link", { name: new RegExp(salad) })).toBeVisible();
  });
});
