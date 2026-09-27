// Cookbooks on both devices, as scratch user 2 (AGENTS.md's scratch index table): create a
// cookbook, save another chef's seeded recipe into it from the recipe's Save dialog, see it listed
// on the cookbook, remove it, rename the cookbook, and delete it. On a phone the dock stays on the
// cookbook list and a cookbook's page, and hides on the new-cookbook form and the title editor
// (R-M3-2); a rename closes the editor with a short confirmation (R-M3-3).
//
// Both device projects run this file at the same time as the same scratch user, so every cookbook
// here has a name unique to this device and run, and the tests assert only on their own cookbooks,
// never on how many cookbooks the user has. The saved recipe is qa_kitchen_friend's seeded Miso
// Glazed Salmon, matched by name and seeded href; saving it touches only this user's cookbook.
import { test, expect } from "./support/journey";
import type { Page } from "@playwright/test";
import { pathUrl, seededRecipeLink, waitForHydration } from "./support/navigation";
import { scratchStorageStatePath } from "./support/personas";

const SALMON = "/recipes/qa-kitchen-recipe-salmon";
const SALMON_TITLE = "Miso Glazed Salmon";
// A cookbook's page: /cookbooks/<id>, never /cookbooks/new.
const COOKBOOK_URL = /^https?:\/\/[^/]+\/cookbooks\/(?!new(?:[?#]|$))[^/?#]+(?:[?#].*)?$/;

// Lowercase letters, digits and hyphens only, so a title built from it needs no escaping in a
// RegExp and one device's titles never contain the other's.
function uniqueSuffix(): string {
  return `${test.info().project.name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function dock(page: Page) {
  return page.getByRole("navigation", { name: "Spoonjoy navigation" });
}

function cookbookHeading(page: Page, title: string) {
  return page.getByRole("heading", { level: 1, name: title, exact: true });
}

function cookbooksHeading(page: Page) {
  return page.getByRole("heading", { level: 1, name: "Cookbooks", exact: true });
}

// A row on /cookbooks. Its name is the title followed by the "N recipes" subtitle.
function cookbookRow(page: Page, title: string) {
  return page.getByRole("main").getByRole("link", { name: new RegExp(`^${title}`) });
}

function ownerToolsToggle(page: Page) {
  return page.getByRole("button", { name: /^Owner tools/ });
}

test.describe("Cookbooks", () => {
  // The stored session path, not scratch(2).storageState: scratch() reads the per-run credentials
  // file, which `playwright test --list` must not need.
  test.use({ storageState: scratchStorageStatePath(2) });

  test("a recipe saved from its page is listed in the cookbook, and removing it empties the cookbook @mutates", async ({ page, isMobile, verifyAfterReload, expectAccessible }) => {
    const title = `Journey shelf ${uniqueSuffix()}`;
    const main = page.getByRole("main");

    // The list keeps the dock on a phone (R-M3-2).
    await page.goto("/cookbooks");
    await waitForHydration(page);
    await expect(cookbooksHeading(page)).toBeVisible();
    await expect(dock(page)).toBeVisible({ visible: isMobile });
    await expectAccessible();

    await main.getByRole("link", { name: "New Cookbook", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/cookbooks/new"));
    await page.getByRole("textbox", { name: /Cookbook Title/ }).fill(title);
    await page.getByRole("button", { name: "Create Cookbook", exact: true }).click();
    await expect(page).toHaveURL(COOKBOOK_URL);
    await expect(cookbookHeading(page, title)).toBeVisible();
    const cookbookPath = new URL(page.url()).pathname;
    await expect(main.getByRole("heading", { name: "No recipes yet", exact: true })).toBeVisible();
    // A cookbook's page is not a form, so the dock stays too (R-M3-2).
    await expect(dock(page)).toBeVisible({ visible: isMobile });

    // Save the friend's recipe into the new cookbook from the recipe's Save dialog: the dock's Save
    // on a phone, the masthead's Save on desktop (no dock there).
    const saveButton = isMobile
      ? dock(page).getByRole("button", { name: "Save", exact: true })
      : page.getByTestId("recipe-header-save-action");
    const saveDialog = page.getByRole("dialog", { name: "Save to Cookbook" });
    const cookbookToggle = saveDialog.getByRole("button", { name: title, exact: true });

    await page.goto(SALMON);
    await waitForHydration(page);
    await expect(page.getByRole("heading", { level: 1, name: SALMON_TITLE, exact: true })).toBeVisible();
    await saveButton.click();
    await expect(saveDialog).toBeVisible();
    await expect(cookbookToggle).toHaveAttribute("aria-pressed", "false");
    // The toggle flips optimistically, so wait for the save itself before leaving the page.
    const saved = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `${SALMON}.data` && response.request().method() === "POST",
    );
    await cookbookToggle.click();
    expect((await saved).status()).toBe(200);
    await expect(cookbookToggle).toHaveAttribute("aria-pressed", "true");
    await expectAccessible();

    await verifyAfterReload(async () => {
      await waitForHydration(page);
      await saveButton.click();
      await expect(saveDialog).toBeVisible();
      await expect(cookbookToggle).toHaveAttribute("aria-pressed", "true");
    });

    // The cookbook, found from the list, shows the recipe.
    await page.goto("/cookbooks");
    await waitForHydration(page);
    await expect(cookbookRow(page, title)).toContainText("1 recipe");
    await cookbookRow(page, title).click();
    await expect(page).toHaveURL(pathUrl(cookbookPath));
    await expect(cookbookHeading(page, title)).toBeVisible();
    await expect(seededRecipeLink(main, SALMON_TITLE, SALMON)).toBeVisible();

    // Remove it through the owner tools' confirmation dialog.
    await ownerToolsToggle(page).click();
    await expect(ownerToolsToggle(page)).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("button", { name: `Remove ${SALMON_TITLE} from cookbook`, exact: true }).click();
    const removeDialog = page.getByRole("alertdialog", { name: "Remove from cookbook?" });
    await expect(removeDialog).toBeVisible();
    await removeDialog.getByRole("button", { name: "Remove it", exact: true }).click();
    await expect(removeDialog).toBeHidden();
    await expect(seededRecipeLink(main, SALMON_TITLE, SALMON)).toHaveCount(0);
    await expect(main.getByRole("heading", { name: "No recipes yet", exact: true })).toBeVisible();
    await expectAccessible();

    await verifyAfterReload(async () => {
      await expect(cookbookHeading(page, title)).toBeVisible();
      await expect(main.getByRole("heading", { name: "No recipes yet", exact: true })).toBeVisible();
      await expect(seededRecipeLink(main, SALMON_TITLE, SALMON)).toHaveCount(0);
    });
  });

  test("renaming closes the editor with a confirmation, and deleting takes the cookbook off the list @mutates", async ({ page, isMobile, verifyAfterReload, expectAccessible, expectConsoleError }) => {
    const suffix = uniqueSuffix();
    const originalTitle = `Journey shelf ${suffix}`;
    const renamedTitle = `Renamed shelf ${suffix}`;
    const titleField = page.getByRole("textbox", { name: "Cookbook title", exact: true });
    const renamedToast = page.getByTestId("toast-snackbar");

    // Typed before hydration on purpose: server-rendered inputs have lost typed text on a phone
    // before (milestone 1), and this proves the new-cookbook title keeps it.
    await page.goto("/cookbooks/new");
    const newTitleField = page.getByRole("textbox", { name: /Cookbook Title/ });
    await newTitleField.fill(originalTitle);
    await waitForHydration(page);
    await expect(newTitleField).toHaveValue(originalTitle);
    // The new-cookbook form hides the dock (R-M3-2).
    await expect(dock(page)).toBeHidden();
    await expectAccessible();
    await page.getByRole("button", { name: "Create Cookbook", exact: true }).click();
    await expect(page).toHaveURL(COOKBOOK_URL);
    await expect(cookbookHeading(page, originalTitle)).toBeVisible();
    const cookbookPath = new URL(page.url()).pathname;

    await ownerToolsToggle(page).click();
    await page.getByRole("button", { name: "Edit title", exact: true }).click();
    await expect(titleField).toHaveValue(originalTitle);
    // The title editor is an edit form, so it hides the dock too (R-M3-2).
    await expect(dock(page)).toBeHidden();

    // A blank title is refused with a 400, and the editor shows why and stays open. Browsers log
    // the rename request's 400 as a console error even though the page handles it.
    expectConsoleError(/Failed to load resource: the server responded with a status of 400/, {
      url: /\/cookbooks\/[^/]+\.data$/,
    });
    await titleField.fill("   ");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Title is required" })).toBeVisible();
    await expect(titleField).toBeVisible();
    await expectAccessible();

    // A good title closes the editor with a short confirmation (R-M3-3) and brings the dock back.
    await titleField.fill(renamedTitle);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(renamedToast).toHaveText("Cookbook renamed.");
    await expect(titleField).toBeHidden();
    await expect(cookbookHeading(page, renamedTitle)).toBeVisible();
    await expect(dock(page)).toBeVisible({ visible: isMobile });

    await verifyAfterReload(async () => {
      await expect(cookbookHeading(page, renamedTitle)).toBeVisible();
    });

    // The list shows the new name only.
    await page.getByRole("link", { name: "← Back to cookbooks", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/cookbooks"));
    await expect(cookbookRow(page, renamedTitle)).toBeVisible();
    await expect(cookbookRow(page, originalTitle)).toHaveCount(0);

    // Delete it through the owner tools' confirmation dialog.
    await cookbookRow(page, renamedTitle).click();
    await expect(page).toHaveURL(pathUrl(cookbookPath));
    await waitForHydration(page);
    await ownerToolsToggle(page).click();
    await page.getByRole("button", { name: "Delete cookbook", exact: true }).click();
    const deleteDialog = page.getByRole("alertdialog", { name: "Delete this cookbook?" });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole("button", { name: "Delete it", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/cookbooks"));
    await expect(cookbooksHeading(page)).toBeVisible();
    await expect(cookbookRow(page, renamedTitle)).toHaveCount(0);
    await expectAccessible();

    await verifyAfterReload(async () => {
      await expect(cookbooksHeading(page)).toBeVisible();
      await expect(cookbookRow(page, renamedTitle)).toHaveCount(0);
    });
  });
});
