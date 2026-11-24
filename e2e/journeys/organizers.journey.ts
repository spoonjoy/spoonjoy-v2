// Organizers on recipes (organizers flag, on in QA), as per-run scratch user 1, whose area is recipe editing: a cook
// makes a recipe, gives it tags, a category and a tool from Organize in the recipe menu as chips (on a phone, in the
// field's sheet), removes one tag, adds it back from the suggestions with different case and adds a new one, and finds them on the recipe's
// Organize page, on a tag's own page, in the list of their tags and in the list of their categories, each after a
// reload; then filters My recipes to the recipe by one of its tags and leaves it out by its tool; and last renames a
// tag, merges the other into it and deletes it from the tag's page. Both device projects run at the same time as the same scratch user, so the recipe and every organizer carry
// the project name and a timestamp.
import type { Locator, Page, TestInfo } from "@playwright/test";
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

// One part of the page, scrolled to the top of the viewport first so the floating tab bar doesn't cover it.
async function attachElementShot(element: Locator, testInfo: TestInfo, name: string): Promise<void> {
  await element.evaluate((node) => node.scrollIntoView({ block: "start" }));
  await testInfo.attach(`${name}-${testInfo.project.name}`, {
    body: await element.screenshot({ animations: "disabled" }),
    contentType: "image/png",
  });
}

// A token field's input: in the form, or on a phone (iphone-webkit) in the sheet its button opens. `done` closes it.
async function openTokens(page: Page, label: string, phone: boolean): Promise<{ input: Locator; scope: Page | Locator; done: () => Promise<void> }> {
  const field = page.getByRole("combobox", { name: label, exact: true });
  if (!phone) {
    await field.click();
    return { input: field, scope: page, done: () => field.press("Escape") };
  }
  await field.click();
  const sheet = page.getByRole("dialog", { name: label, exact: true });
  await expect(sheet).toBeVisible();
  const input = sheet.getByRole("combobox", { name: label, exact: true });
  await input.click();
  return {
    input,
    scope: sheet,
    done: async () => {
      await sheet.getByRole("button", { name: "Done", exact: true }).click();
      await expect(sheet).toHaveCount(0);
    },
  };
}

// Types a name the cook doesn't have yet and makes it a chip: Enter in the form, the sheet's Add row on a phone.
async function addNewToken(page: Page, label: string, name: string, phone: boolean): Promise<void> {
  const { input, scope, done } = await openTokens(page, label, phone);
  await input.pressSequentially(name);
  if (phone) await scope.getByRole("option", { name: `Add “${name}”`, exact: true }).click();
  else await input.press("Enter");
  await done();
}

// Types `typed` and picks the cook's existing `name` from the suggestions.
async function addSuggestedToken(page: Page, label: string, typed: string, name: string, phone: boolean): Promise<void> {
  const { input, scope, done } = await openTokens(page, label, phone);
  await input.pressSequentially(typed);
  await expect(scope.getByRole("option", { name: `Add “${typed}”`, exact: true })).toHaveCount(0);
  await scope.getByRole("option", { name, exact: true }).click();
  await done();
}

// Removes a chip: its Remove button in the form, or picking its row again in the phone's sheet.
async function removeToken(page: Page, label: string, name: string, phone: boolean): Promise<void> {
  if (!phone) {
    await page.getByRole("button", { name: `Remove ${name}`, exact: true }).click();
    return;
  }
  const { scope, done } = await openTokens(page, label, phone);
  await scope.getByRole("option", { name, exact: true }).click();
  await done();
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
    const phone = testInfo.project.name === "iphone-webkit";
    const spare = `Spare ${suffix}`;
    await addNewToken(page, "Tags", cozy, phone);
    await addNewToken(page, "Tags", spare, phone);
    await addNewToken(page, "Categories", supper, phone);
    await addNewToken(page, "Tools", pot, phone);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();

    const onRecipe = page.getByRole("region", { name: "Tags on this recipe", exact: true });
    await verifyAfterReload(async () => {
      await expect(onRecipe.getByRole("link", { name: cozy, exact: true })).toBeVisible();
      await expect(onRecipe.getByRole("link", { name: spare, exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Categories on this recipe", exact: true }).getByRole("link", { name: supper, exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Tools on this recipe", exact: true }).getByRole("link", { name: pot, exact: true })).toBeVisible();
    });

    // Remove one tag; it stays the cook's, off this recipe.
    await waitForHydration(page);
    await removeToken(page, "Tags", spare, phone);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    await verifyAfterReload(async () => {
      await expect(onRecipe.getByRole("link", { name: cozy, exact: true })).toBeVisible();
      await expect(onRecipe.getByRole("link", { name: spare, exact: true })).toHaveCount(0);
    });

    // Typing it in lower case suggests the cook's own tag, so it comes back as it was instead of forking; and a new one.
    await waitForHydration(page);
    await addSuggestedToken(page, "Tags", spare.toLowerCase(), spare, phone);
    await addNewToken(page, "Tags", quick, phone);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    await verifyAfterReload(async () => {
      await expect(onRecipe.getByRole("link", { name: cozy, exact: true })).toBeVisible();
      await expect(onRecipe.getByRole("link", { name: quick, exact: true })).toBeVisible();
      await expect(onRecipe.getByRole("link", { name: spare, exact: true })).toBeVisible();
      await expect(onRecipe.getByRole("link")).toHaveCount(3);
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
    await attachElementShot(page.getByRole("region", { name: "Change this tag", exact: true }), testInfo, "tag-change-section");
    const rename = page.getByRole("form", { name: "Rename this tag", exact: true });
    await rename.getByLabel("Name", { exact: true }).fill(snug);
    await rename.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: snug, exact: true })).toBeVisible();
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
    await attachElementShot(page.getByRole("region", { name: "Change this tag", exact: true }), testInfo, "tag-merge-chosen");
    await merge.getByRole("button", { name: "Merge", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: snug, exact: true })).toBeVisible();
    await verifyAfterReload(async () => {
      await expect(page.getByRole("list", { name: `Recipes tagged ${snug}`, exact: true }).getByRole("link", { name: title })).toBeVisible();
    });
    await attachElementShot(page.getByRole("list", { name: `Recipes tagged ${snug}`, exact: true }), testInfo, "tag-merged-recipes-after-reload");

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
