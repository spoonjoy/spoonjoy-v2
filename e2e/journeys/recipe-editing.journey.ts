// Recipe create and edit on both devices (spec journey 7), as per-run scratch user 1: build a new
// recipe with two steps and their ingredients, rename it, add a third step on the Add Step page,
// change a step's ingredient, reorder the steps, delete a step and finally delete the recipe.
//
// Both device projects run this at the same time as the same scratch user, so each run's recipe
// title carries the project name and a timestamp; everything else the test touches belongs to that
// recipe. AI ingredient parsing is switched off in favour of manual entry (QA may have no OpenAI
// key), except for one deliberate parse on the Add Step page, which must not take the page down.
import { test, expect } from "./support/journey";
import type { Page } from "@playwright/test";
import { pathUrl, waitForHydration } from "./support/navigation";
import { scratchStorageStatePath } from "./support/personas";

// A recipe page, not /recipes/new.
const RECIPE_URL = /\/recipes\/(?!new$)[^/?#]+$/;

// A step on the recipe page (StepCard articles, named "Step N").
function recipeStep(page: Page, stepNum: number) {
  return page.locator("#steps").getByRole("article", { name: `Step ${stepNum}`, exact: true });
}

// A step on the recipe's edit page (articles named "Step N").
function editPageStep(page: Page, stepNum: number) {
  return page.getByRole("region", { name: "Recipe Steps" }).getByRole("article", { name: `Step ${stepNum}`, exact: true });
}

function ingredient(page: Page, name: string) {
  return page.getByRole("checkbox", { name, exact: true });
}

async function openMaintenance(page: Page) {
  await page.getByRole("button", { name: /^Manage recipe/ }).click();
  return page.locator("#recipe-owner-maintenance");
}

test.describe("Recipe create and edit", () => {
  test.use({ storageState: scratchStorageStatePath(1) });

  test("a chef builds, renames, extends, reorders and deletes a recipe @mutates", async ({
    page,
    verifyAfterReload,
    expectAccessible,
    expectConsoleError,
  }, testInfo) => {
    // Many round trips to QA in one story; the default 60 s is too tight.
    test.setTimeout(180_000);
    const suffix = `${testInfo.project.name} ${Date.now().toString(36)}`;
    const title = `Journey Toast ${suffix}`;
    const renamed = `Journey French Toast ${suffix}`;
    const recipeHeading = (name: string) => page.getByRole("heading", { level: 1, name, exact: true });

    // --- Build the recipe. The title is typed straight after the server markup arrives, before
    // hydration, so a controlled field that hydration resets would lose it (milestone 1's bug).
    await page.goto("/recipes/new", { waitUntil: "commit" });
    const titleField = page.getByLabel("Title", { exact: true });
    await titleField.fill(title);
    await waitForHydration(page);
    await page.getByLabel("Description", { exact: true }).fill("Crisp outside, soft inside.");
    await page.getByLabel("Servings", { exact: true }).fill("2 servings");
    await expect(titleField).toHaveValue(title);

    // Two steps with manual ingredients. Neither card's own "Save" is pressed (R-M3-1).
    await page.getByRole("button", { name: "Add Step", exact: true }).click();
    const firstCard = page.getByRole("article", { name: "Step 1", exact: true });
    await firstCard.getByLabel("Instructions").fill("Toast the bread");
    await firstCard.getByRole("switch", { name: "AI Parse" }).setChecked(false);
    await firstCard.getByLabel("Quantity").fill("2");
    await firstCard.getByLabel("Unit").fill("slice");
    await firstCard.getByLabel("Ingredient", { exact: true }).fill("bread");
    await firstCard.getByRole("button", { name: "Add ingredient" }).click();
    await expect(firstCard.getByRole("button", { name: "Remove bread" })).toBeVisible();

    await page.getByRole("button", { name: "Add Step", exact: true }).click();
    const secondCard = page.getByRole("article", { name: "Step 2", exact: true });
    await secondCard.getByLabel("Instructions").fill("Butter the toast");
    await secondCard.getByRole("switch", { name: "AI Parse" }).setChecked(false);
    await secondCard.getByLabel("Quantity").fill("1");
    await secondCard.getByLabel("Unit").fill("tbsp");
    await secondCard.getByLabel("Ingredient", { exact: true }).fill("butter");
    await secondCard.getByRole("button", { name: "Add ingredient" }).click();
    await expect(secondCard.getByRole("button", { name: "Remove butter" })).toBeVisible();
    // Both cards' manual forms are on the page at once; their labels must not collide.
    await expectAccessible();

    await page.getByRole("button", { name: "Create Recipe", exact: true }).click();
    await expect(page).toHaveURL(RECIPE_URL);
    const recipePath = new URL(page.url()).pathname;
    await expect(recipeHeading(title)).toBeVisible();
    await expect(recipeStep(page, 1)).toContainText("Toast the bread");
    await expect(recipeStep(page, 1).getByRole("checkbox", { name: "bread", exact: true })).toBeVisible();
    await expect(recipeStep(page, 2)).toContainText("Butter the toast");
    await expect(recipeStep(page, 2).getByRole("checkbox", { name: "butter", exact: true })).toBeVisible();
    await expectAccessible();

    await verifyAfterReload(async () => {
      await expect(recipeHeading(title)).toBeVisible();
      await expect(recipeStep(page, 1)).toContainText("Toast the bread");
      await expect(recipeStep(page, 1).getByRole("checkbox", { name: "bread", exact: true })).toBeVisible();
      await expect(recipeStep(page, 2)).toContainText("Butter the toast");
      await expect(recipeStep(page, 2).getByRole("checkbox", { name: "butter", exact: true })).toBeVisible();
    });

    // --- Rename it.
    await waitForHydration(page);
    await (await openMaintenance(page)).getByRole("link", { name: "Edit recipe" }).click();
    await expect(page).toHaveURL(pathUrl(`${recipePath}/edit`));
    await expect(titleField).toHaveValue(title);
    await titleField.fill(renamed);
    await page.getByRole("button", { name: "Save Recipe", exact: true }).click();
    await expect(page).toHaveURL(pathUrl(recipePath));
    await expect(recipeHeading(renamed)).toBeVisible();

    await verifyAfterReload(async () => {
      await expect(recipeHeading(renamed)).toBeVisible();
    });

    // --- Add a third step on the Add Step page. The AI box's text is typed straight after the
    // server markup arrives, before hydration: it has to survive hydration (bug 5) and then be
    // parsed through the page's own action (bug 1), which answers 200 whether or not QA can
    // parse, and the page stays.
    const parseResponse = page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname.startsWith(`${recipePath}/steps/new`),
    );
    await page.goto(`${recipePath}/steps/new`, { waitUntil: "commit" });
    const ingredientText = page.getByRole("textbox", { name: "Ingredient text" });
    await ingredientText.fill("2 tbsp honey");
    await waitForHydration(page);
    await expect(page.getByRole("heading", { level: 1, name: "Add Step", exact: true })).toBeVisible();
    // Typing elsewhere moves focus, which re-renders the fields after hydration.
    await page.getByRole("textbox", { name: "Description *" }).fill("Drizzle with honey");
    await expect(ingredientText).toHaveValue("2 tbsp honey");
    const parsed = await parseResponse;
    expect(new URL(parsed.url()).pathname).toBe(`${recipePath}/steps/new.data`);
    expect(parsed.status()).toBe(200);
    // Parsed, or a message that AI parsing is unavailable with the manual path; never "Page not found".
    await expect(page.getByRole("heading", { name: /^Ingredients \(\d+\)$/ }).or(page.getByRole("alert"))).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Add Step", exact: true })).toBeVisible();
    await expectAccessible();

    await page.getByRole("switch", { name: "AI Parse" }).setChecked(false);
    await page.getByLabel("Quantity").fill("2");
    await page.getByLabel("Unit").fill("tbsp");
    await page.getByLabel("Ingredient", { exact: true }).fill("honey");
    await page.getByRole("button", { name: "Add ingredient" }).click();
    await expect(page.getByRole("button", { name: "Remove honey" })).toBeVisible();
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page).toHaveURL(/\/steps\/[^/?#]+\/edit(?:\?.*)?$/);
    await expect(page.getByRole("status").filter({ hasText: "Step created successfully." })).toBeVisible();

    // --- Change step 1's ingredient: bread becomes brioche.
    await page.getByRole("link", { name: "← Back to recipe" }).click();
    await expect(page).toHaveURL(pathUrl(`${recipePath}/edit`));
    await expect(page.getByRole("link", { name: "+ Add Step" })).toHaveAttribute("href", `${recipePath}/steps/new`);
    await expect(editPageStep(page, 3)).toContainText("Drizzle with honey");
    await expect(editPageStep(page, 3)).toContainText("1 ingredient");
    await editPageStep(page, 1).getByRole("link", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Edit Step", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "+ Add Ingredient" }).click();
    await page.getByRole("switch", { name: "AI Parse" }).setChecked(false);
    await page.getByLabel("Quantity").fill("2");
    await page.getByLabel("Unit").fill("slice");
    await page.getByLabel("Ingredient", { exact: true }).fill("brioche");
    await page.getByRole("button", { name: "Add ingredient" }).click();
    await expect(page.getByRole("button", { name: "Remove brioche" })).toBeVisible();

    await page.getByRole("button", { name: "Remove bread" }).click();
    const removeDialog = page.getByRole("alertdialog", { name: "Remove this ingredient?" });
    await removeDialog.getByRole("button", { name: "Remove it" }).click();
    await expect(page.getByRole("button", { name: "Remove bread" })).toHaveCount(0);

    await page.getByRole("button", { name: "Update", exact: true }).click();
    await expect(page).toHaveURL(pathUrl(`${recipePath}/edit`));

    // --- Reorder: "Butter the toast" moves up to step 1.
    await editPageStep(page, 2).getByRole("button", { name: "Move Up" }).click();
    await expect(editPageStep(page, 1)).toContainText("Butter the toast");
    await expect(editPageStep(page, 2)).toContainText("Toast the bread");

    // --- Delete step 3 through its dialog.
    await editPageStep(page, 3).getByRole("button", { name: "Delete", exact: true }).click();
    const deleteStepDialog = page.getByRole("alertdialog", { name: "Delete Step" });
    await deleteStepDialog.getByRole("button", { name: "Confirm" }).click();
    await expect(editPageStep(page, 3)).toHaveCount(0);

    // The recipe page shows the new order, the changed ingredient and no third step.
    await page.goto(recipePath);
    await expect(recipeHeading(renamed)).toBeVisible();
    await verifyAfterReload(async () => {
      await expect(recipeStep(page, 1)).toContainText("Butter the toast");
      await expect(recipeStep(page, 1).getByRole("checkbox", { name: "butter", exact: true })).toBeVisible();
      await expect(recipeStep(page, 2)).toContainText("Toast the bread");
      await expect(recipeStep(page, 2).getByRole("checkbox", { name: "brioche", exact: true })).toBeVisible();
      await expect(ingredient(page, "bread")).toHaveCount(0);
      await expect(recipeStep(page, 3)).toHaveCount(0);
      await expect(ingredient(page, "honey")).toHaveCount(0);
    });

    // --- Delete the recipe.
    await waitForHydration(page);
    await (await openMaintenance(page)).getByRole("button", { name: "Delete", exact: true }).click();
    const deleteRecipeDialog = page.getByRole("alertdialog", { name: /^Delete ".+"\?$/ });
    await deleteRecipeDialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/recipes"));

    // Its page is gone. The browser logs the document's 404 as a console error; that one is
    // expected, and scoped to this recipe's URL.
    expectConsoleError(/Failed to load resource: the server responded with a status of 404/, {
      url: new RegExp(`${recipePath}$`),
    });
    await page.goto(recipePath);
    // The link says the recipe was deleted, rather than calling it a missing page.
    await expect(page.getByRole("heading", { level: 1, name: "This recipe was deleted." })).toBeVisible();
    await testInfo.attach("deleted-recipe-page", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  });
});
