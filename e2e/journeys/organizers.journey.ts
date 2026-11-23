// Organizers on recipes (organizers flag, on in QA), as per-run scratch user 1, whose area is recipe editing: a cook
// makes a recipe, gives it tags, a category and a tool from Organize in the recipe menu, and finds them on the recipe's
// Organize page, on a tag's own page, in the list of their tags and in the list of their categories, each after a
// reload; then filters My recipes to the recipe by one of its tags and leaves it out by its tool; and last renames a
// tag, merges the other into it and deletes it from the tag's page. Both device projects run at the same time as the same scratch user, so the recipe and every organizer carry
// the project name and a timestamp.
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

test.describe("Organizers", () => {
  test.use({ storageState: scratchStorageStatePath(1) });

  test("a cook organizes a recipe, finds it under each tag and category, filters My recipes by them, and renames, merges and deletes a tag, each after a reload @mutates", async ({ page, verifyAfterReload, expectAccessible }, testInfo) => {
    test.setTimeout(180_000);
    const suffix = `${testInfo.project.name} ${Date.now().toString(36)}`;
    const title = `Journey Tagged Soup ${suffix}`;
    const cozy = `Cozy ${suffix}`;
    const quick = `Quick ${suffix}`;
    const supper = `Supper ${suffix}`;
    const pot = `Stockpot ${suffix}`;

    // A recipe with only a title.
    await page.goto("/recipes/new", { waitUntil: "commit" });
    const titleField = page.getByLabel(requiredLabel("Title"), { exact: true });
    await waitForHydration(page);
    await titleField.fill(title);
    await page.getByRole("button", { name: "Create recipe", exact: true }).click();
    await expect(page).toHaveURL(RECIPE_URL);
    const recipePath = new URL(page.url()).pathname;

    // Organize, from the recipe menu.
    await waitForHydration(page);
    await chooseMenuItem(page, page.getByRole("button", { name: "Recipe actions", exact: true }), "Organize");
    await expect(page).toHaveURL(pathUrl(`${recipePath}/organize`));
    await expect(page.getByRole("heading", { level: 1, name: "Organize", exact: true })).toBeVisible();
    await waitForHydration(page);
    await page.getByLabel("Tags", { exact: true }).fill(`${quick}, ${cozy}, ${quick.toLowerCase()}`);
    await page.getByLabel("Categories", { exact: true }).fill(supper);
    await page.getByLabel("Tools", { exact: true }).fill(pot);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();

    const onRecipe = page.getByRole("region", { name: "Tags on this recipe", exact: true });
    await verifyAfterReload(async () => {
      await expect(page.getByLabel("Tags", { exact: true })).toHaveValue(`${cozy}, ${quick}`);
      await expect(page.getByLabel("Categories", { exact: true })).toHaveValue(supper);
      await expect(page.getByLabel("Tools", { exact: true })).toHaveValue(pot);
      await expect(onRecipe.getByRole("link", { name: cozy, exact: true })).toBeVisible();
      await expect(onRecipe.getByRole("link", { name: quick, exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Tools on this recipe", exact: true }).getByRole("link", { name: pot, exact: true })).toBeVisible();
    });
    await expectAccessible();
    await attachScreenshot(page, testInfo, "recipe-organize-after-reload");

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

    // The cook's categories list the new one with the recipe.
    await page.goto("/categories");
    await waitForHydration(page);
    const yourCategories = page.getByRole("list", { name: "Your categories", exact: true });
    await verifyAfterReload(async () => {
      await expect(yourCategories.getByRole("listitem").filter({ hasText: supper })).toContainText("1 recipe");
    });
    await expectAccessible();
    await attachScreenshot(page, testInfo, "your-categories-after-reload");

    // My recipes, searched to this run's recipe, filtered to the recipe's tag: it's there.
    await page.goto(`/my-recipes?q=${encodeURIComponent(suffix)}`);
    await waitForHydration(page);
    const filter = page.getByRole("form", { name: "Filter my recipes", exact: true });
    await filter.getByRole("button", { name: "Filter", exact: true }).click();
    await filter.getByRole("group", { name: "Has", exact: true }).getByRole("checkbox", { name: quick, exact: true }).click();
    await filter.getByRole("button", { name: "Apply filters", exact: true }).click();
    await expect(page).toHaveURL(/[?&]with=tag%3A/);
    const mine = page.getByRole("list", { name: "My recipes", exact: true });
    await verifyAfterReload(async () => {
      await expect(mine.getByRole("link", { name: title })).toBeVisible();
      await expect(filter.getByRole("group", { name: "Has", exact: true }).getByRole("checkbox", { name: quick, exact: true })).toBeChecked();
    });
    await expectAccessible();
    await attachScreenshot(page, testInfo, "my-recipes-with-tag-after-reload");

    // Leaving out the recipe's tool takes it away.
    await waitForHydration(page);
    await filter.getByRole("group", { name: "Leave out", exact: true }).getByRole("checkbox", { name: pot, exact: true }).click();
    await filter.getByRole("button", { name: "Apply filters", exact: true }).click();
    await expect(page).toHaveURL(/[?&]without=tool%3A/);
    await verifyAfterReload(async () => {
      await expect(page.getByRole("heading", { name: "No matching recipes", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Filter (2)", exact: true })).toBeVisible();
    });
    await attachScreenshot(page, testInfo, "my-recipes-without-tool-after-reload");

    // Rename a tag from its page.
    const snug = `Snug ${suffix}`;
    await page.goto("/tags");
    await waitForHydration(page);
    await yourTags.getByRole("link", { name: cozy, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: cozy, exact: true })).toBeVisible();
    await waitForHydration(page);
    const rename = page.getByRole("form", { name: "Rename this tag", exact: true });
    await rename.getByLabel("Name", { exact: true }).fill(snug);
    await rename.getByRole("button", { name: "Rename", exact: true }).click();
    await verifyAfterReload(async () => {
      await expect(page.getByRole("heading", { level: 1, name: snug, exact: true })).toBeVisible();
    });
    await expectAccessible();
    await attachScreenshot(page, testInfo, "tag-renamed-after-reload");

    // Merge the other tag into it: the recipe is still under the kept one, and the merged one is gone.
    await page.goto("/tags");
    await waitForHydration(page);
    await yourTags.getByRole("link", { name: quick, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: quick, exact: true })).toBeVisible();
    await waitForHydration(page);
    const merge = page.getByRole("form", { name: "Merge this tag", exact: true });
    await merge.getByLabel("Merge into", { exact: true }).selectOption({ label: snug });
    await merge.getByRole("button", { name: "Merge", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: snug, exact: true })).toBeVisible();
    await verifyAfterReload(async () => {
      await expect(page.getByRole("list", { name: `Recipes tagged ${snug}`, exact: true }).getByRole("link", { name: title })).toBeVisible();
    });
    await attachScreenshot(page, testInfo, "tag-merged-after-reload");

    // Delete it, after saying yes: the list no longer has either.
    await waitForHydration(page);
    await page.getByRole("button", { name: "Delete tag", exact: true }).click();
    await page.getByRole("alertdialog", { name: `Delete ${snug}?`, exact: true }).getByRole("button", { name: "Delete it", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/tags"));
    await verifyAfterReload(async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Your tags", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: snug, exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: quick, exact: true })).toHaveCount(0);
    });
    await attachScreenshot(page, testInfo, "tag-deleted-after-reload");
  });
});
