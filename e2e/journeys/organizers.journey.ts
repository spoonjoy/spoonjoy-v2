// Tags on recipes (organizers flag, on in QA), as per-run scratch user 1, whose area is recipe editing: a cook makes a
// recipe, tags it from the recipe menu, and finds the tags on the recipe's Tags page, on the tag's own page and in the
// list of their tags, each after a reload. Both device projects run at the same time as the same scratch user, so the
// recipe and both tags carry the project name and a timestamp.
import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "./support/journey";
import { chooseMenuItem } from "./support/menu";
import { pathUrl, waitForHydration } from "./support/navigation";
import { scratchStorageStatePath } from "./support/personas";
import { requiredLabel } from "./support/forms";

// A recipe page, not /recipes/new.
const RECIPE_URL = /\/recipes\/(?!new$)[^/?#]+$/;

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(`${name}-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true, animations: "disabled" }),
    contentType: "image/png",
  });
}

test.describe("Tags", () => {
  test.use({ storageState: scratchStorageStatePath(1) });

  test("a cook tags a recipe and finds it under each tag after a reload @mutates", async ({ page, verifyAfterReload, expectAccessible }, testInfo) => {
    test.setTimeout(120_000);
    const suffix = `${testInfo.project.name} ${Date.now().toString(36)}`;
    const title = `Journey Tagged Soup ${suffix}`;
    const cozy = `Cozy ${suffix}`;
    const quick = `Quick ${suffix}`;

    // A recipe with only a title.
    await page.goto("/recipes/new", { waitUntil: "commit" });
    const titleField = page.getByLabel(requiredLabel("Title"), { exact: true });
    await waitForHydration(page);
    await titleField.fill(title);
    await page.getByRole("button", { name: "Create recipe", exact: true }).click();
    await expect(page).toHaveURL(RECIPE_URL);
    const recipePath = new URL(page.url()).pathname;

    // Tags, from the recipe menu.
    await waitForHydration(page);
    await chooseMenuItem(page, page.getByRole("button", { name: "Recipe actions", exact: true }), "Tags");
    await expect(page).toHaveURL(pathUrl(`${recipePath}/tags`));
    await expect(page.getByRole("heading", { level: 1, name: "Tags", exact: true })).toBeVisible();
    await waitForHydration(page);
    await page.getByLabel("Tags", { exact: true }).fill(`${quick}, ${cozy}, ${quick.toLowerCase()}`);
    await page.getByRole("button", { name: "Save tags", exact: true }).click();
    await expect(page.getByText("Tags saved.", { exact: true })).toBeVisible();

    const onRecipe = page.getByRole("region", { name: "Tags on this recipe", exact: true });
    await verifyAfterReload(async () => {
      await expect(page.getByLabel("Tags", { exact: true })).toHaveValue(`${cozy}, ${quick}`);
      await expect(onRecipe.getByRole("link", { name: cozy, exact: true })).toBeVisible();
      await expect(onRecipe.getByRole("link", { name: quick, exact: true })).toBeVisible();
    });
    await expectAccessible();
    await attachScreenshot(page, testInfo, "recipe-tags-after-reload");

    // The tag's own page lists the recipe.
    await waitForHydration(page);
    await onRecipe.getByRole("link", { name: cozy, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: cozy, exact: true })).toBeVisible();
    const tagged = page.getByRole("list", { name: `Recipes tagged ${cozy}`, exact: true });
    await verifyAfterReload(async () => {
      await expect(page.getByRole("heading", { level: 1, name: cozy, exact: true })).toBeVisible();
      await expect(tagged.getByRole("listitem").filter({ hasText: title }).getByRole("link").first()).toHaveAttribute("href", recipePath);
    });
    await expectAccessible();
    await attachScreenshot(page, testInfo, "tag-page-after-reload");

    // The cook's tags list both, with one recipe each.
    await waitForHydration(page);
    await page.getByRole("link", { name: "All tags", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Your tags", exact: true })).toBeVisible();
    const yourTags = page.getByRole("list", { name: "Your tags", exact: true });
    await verifyAfterReload(async () => {
      await expect(yourTags.getByRole("listitem").filter({ hasText: cozy })).toContainText("1 recipe");
      await expect(yourTags.getByRole("listitem").filter({ hasText: quick })).toContainText("1 recipe");
    });
    await attachScreenshot(page, testInfo, "your-tags-after-reload");
  });
});
