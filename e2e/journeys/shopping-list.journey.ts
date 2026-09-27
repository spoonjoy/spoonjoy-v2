// Shopping list on both devices (spec journey 9), as per-run scratch user 3: add an item by hand,
// check it into the basket and back, remove it; add a seeded recipe's ingredients at 2x from its
// page; review and confirm an item the parser can't read; tap two rows in quick succession; and
// clear checked items, then everything.
//
// A user has one shopping list, and the two device projects run at the same time, so each device
// signs in as its own account: scratch 3's base account on iPhone, its desktop twin on desktop
// Chrome (support/personas.ts's scratchStorageStateForProject). Each device owns its whole list,
// so these tests assert on the list's full contents. Every test starts by emptying the list
// through the UI (add a placeholder, then "Clear all"), so a test never depends on what an
// earlier one left behind.
//
// QA has no OpenAI key for shopping-list parsing, so items typed by hand go through the fallback
// parser: "2 lemons" is 2 / whole / lemons, and "salt" (no amount) is ambiguous and needs review.
import { test, expect } from "./support/journey";
import type { Page, Response } from "@playwright/test";
import { pathUrl, waitForHydration } from "./support/navigation";
import { scratchStorageStateForProject } from "./support/personas";

const SHOPPING_LIST = "/shopping-list";
const SHOPPING_LIST_ACTION = "/shopping-list.data";
const TOMATO_SOUP = "/recipes/qa-kitchen-recipe-tomato-soup";

function itemField(page: Page) {
  return page.getByLabel("Item", { exact: true });
}

function addSection(page: Page) {
  return page.locator("#add-item");
}

function row(page: Page, name: string) {
  return page.getByRole("checkbox", { name, exact: true });
}

// The "Need N" / "Basket N" / "All N" view buttons (CSS uppercases them).
function view(page: Page, label: "Need" | "Basket" | "All", count: number) {
  return page.getByRole("button", { name: new RegExp(`^${label} ${count}$`, "i") });
}

function emptyList(page: Page) {
  return page.getByRole("heading", { level: 2, name: "Your shopping list is empty", exact: true });
}

function isShoppingListAction(response: Response, intent: string): boolean {
  const request = response.request();
  return (
    request.method() === "POST" &&
    new URL(response.url()).pathname === SHOPPING_LIST_ACTION &&
    (request.postData() ?? "").includes(`intent=${intent}`)
  );
}

// The next response to a shopping-list action with this intent. Start waiting before the tap.
function nextShoppingListAction(page: Page, intent: string): Promise<Response> {
  return page.waitForResponse((response) => isShoppingListAction(response, intent));
}

// Every response to a shopping-list action with this intent from now on, as HTTP statuses. A
// request the browser cancels never gets a response, so it never shows up here.
function recordShoppingListActions(page: Page, intent: string): number[] {
  const statuses: number[] = [];
  page.on("response", (response) => {
    if (isShoppingListAction(response, intent)) statuses.push(response.status());
  });
  return statuses;
}

// Adds an item by hand and waits for its row. A successful add clears the field (R-M3-3).
async function addByHand(page: Page, text: string, name: string, amount: string) {
  await itemField(page).fill(text);
  await addSection(page).getByRole("button", { name: "Add", exact: true }).click();
  await expect(row(page, name)).toContainText(amount);
  await expect(itemField(page)).toHaveValue("");
}

async function clearAll(page: Page) {
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Start fresh?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Clear all", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(emptyList(page)).toBeVisible();
}

// Empties this device's list through the UI. A placeholder item first, so "Clear all" (shown only
// when the list has items) is always there to press, whatever an earlier test left behind. The
// placeholder is the seeded ingredient "lemon", so it adds nothing new to QA's shared ingredient
// names.
async function startWithAnEmptyList(page: Page) {
  await page.goto(SHOPPING_LIST);
  await waitForHydration(page);
  await addByHand(page, "1 lemon", "lemon", "1 whole");
  await clearAll(page);
}

test.describe("Shopping list", () => {
  test.use({ storageState: scratchStorageStateForProject(3) });

  test("an item added by hand is checked into the basket, survives a reload, and is removed @mutates", async ({
    page,
    verifyAfterReload,
    expectAccessible,
  }) => {
    test.setTimeout(120_000);
    await startWithAnEmptyList(page);
    const lemons = row(page, "lemons");

    // The item is typed straight after the server markup arrives, before hydration, so a field
    // that hydration resets would lose it (milestone 1's bug class).
    await page.goto(SHOPPING_LIST, { waitUntil: "commit" });
    await page.locator('input[name="ingredientText"]').fill("2 lemons");
    await waitForHydration(page);
    await expect(itemField(page)).toHaveValue("2 lemons");
    await addSection(page).getByRole("button", { name: "Add", exact: true }).click();
    await expect(lemons).toContainText("2 whole");
    await expect(lemons).toHaveAttribute("aria-checked", "false");
    // R-M3-3: the field clears, so pressing Add again can't add the lemons twice (bug 10). The
    // empty field is required, so the browser doesn't submit it.
    await expect(itemField(page)).toHaveValue("");
    await addSection(page).getByRole("button", { name: "Add", exact: true }).click();
    await expect(lemons).toContainText("2 whole");
    await expect(view(page, "Need", 1)).toBeVisible();
    await expectAccessible();

    // Check it: it moves to the basket.
    const checked = nextShoppingListAction(page, "toggleCheck");
    await lemons.click();
    await expect(lemons).toHaveAttribute("aria-checked", "true");
    expect((await checked).status()).toBe(200);
    await expect(view(page, "Basket", 1)).toBeVisible();
    await expect(view(page, "Need", 0)).toBeVisible();
    await view(page, "Basket", 1).click();
    await expect(view(page, "Basket", 1)).toHaveAttribute("aria-pressed", "true");
    await expect(lemons).toBeVisible();
    await view(page, "Need", 0).click();
    await expect(page.getByRole("heading", { level: 2, name: "Nothing left in this view", exact: true })).toBeVisible();
    await expect(lemons).toBeHidden();
    await expectAccessible();

    await verifyAfterReload(async () => {
      await expect(lemons).toHaveAttribute("aria-checked", "true");
      await expect(lemons).toContainText("2 whole");
      await expect(view(page, "Basket", 1)).toBeVisible();
    });

    // Uncheck it, then remove it (its "Remove lemons" button is for keyboards and screen readers).
    await waitForHydration(page);
    const unchecked = nextShoppingListAction(page, "toggleCheck");
    await lemons.click();
    await expect(lemons).toHaveAttribute("aria-checked", "false");
    expect((await unchecked).status()).toBe(200);
    await expect(view(page, "Need", 1)).toBeVisible();

    const removed = nextShoppingListAction(page, "removeItem");
    await page.getByRole("button", { name: "Remove lemons", exact: true }).press("Enter");
    expect((await removed).status()).toBe(200);
    await expect(lemons).toBeHidden();
    await expect(emptyList(page)).toBeVisible();

    await verifyAfterReload(async () => {
      await expect(emptyList(page)).toBeVisible();
      await expect(lemons).toBeHidden();
    });
  });

  test("a recipe's ingredients added from its page at 2x are on the list doubled @mutates", async ({
    page,
    verifyAfterReload,
    expectAccessible,
  }) => {
    test.setTimeout(120_000);
    await startWithAnEmptyList(page);
    const listAction = page.getByTestId("recipe-header-list-action");
    const scaleDisplay = page.getByTestId("scale-display");
    const increaseScale = page.getByRole("button", { name: "Increase scale" });

    // qa_kitchen_chef's seeded Roasted Tomato Soup: 6 whole tomato, 4 clove garlic, 2 cup vegetable
    // stock. Its seeded URL and title together, since a fork can share the title.
    await page.goto(TOMATO_SOUP);
    await waitForHydration(page);
    await expect(page).toHaveURL(pathUrl(TOMATO_SOUP));
    await expect(page.getByRole("heading", { level: 1, name: "Roasted Tomato Soup", exact: true })).toBeVisible();
    await expect(listAction).toHaveText("Add to list");

    // 2x, four presses of 0.25.
    await increaseScale.click();
    await expect(scaleDisplay).toHaveText("1.25×");
    await increaseScale.click();
    await expect(scaleDisplay).toHaveText("1.5×");
    await increaseScale.click();
    await expect(scaleDisplay).toHaveText("1.75×");
    await increaseScale.click();
    await expect(scaleDisplay).toHaveText("2×");

    await listAction.click();
    // The toast appears once QA's add-and-reload round trip finishes, which can be slow.
    await expect(page.getByRole("status").filter({ hasText: "3 items added at 2x" })).toBeVisible({ timeout: 15_000 });
    await expect(listAction).toHaveText("In list");
    await expect(listAction).toHaveAttribute("aria-pressed", "true");
    await expectAccessible();

    // The list holds exactly the doubled quantities.
    const tomato = row(page, "tomato");
    const garlic = row(page, "garlic");
    const stock = row(page, "vegetable stock");
    await page.goto(SHOPPING_LIST);
    await expect(tomato).toContainText("12 whole");
    await expect(garlic).toContainText("8 clove");
    await expect(stock).toContainText("4 cup");
    await expect(view(page, "All", 3)).toBeVisible();
    await expectAccessible();

    await verifyAfterReload(async () => {
      await expect(tomato).toContainText("12 whole");
      await expect(garlic).toContainText("8 clove");
      await expect(stock).toContainText("4 cup");
      await expect(view(page, "All", 3)).toBeVisible();
    });

    // Back on the recipe, it reads as already on the list.
    await page.goto(TOMATO_SOUP);
    await expect(listAction).toHaveText("In list");
    await expect(listAction).toHaveAttribute("aria-pressed", "true");
  });

  test("an item the parser can't read is reviewed, confirmed and added @mutates", async ({
    page,
    verifyAfterReload,
    expectAccessible,
    expectConsoleError,
  }) => {
    test.setTimeout(120_000);
    await startWithAnEmptyList(page);
    const salt = row(page, "salt");
    const review = addSection(page);

    // "salt" has no amount, so the add answers 400 with fields to review. The browser logs that
    // 400 as a console error; it is expected, and only for the shopping list's own action.
    expectConsoleError(/Failed to load resource: the server responded with a status of 400/, {
      url: /\/shopping-list\.data$/,
    });
    const ambiguous = nextShoppingListAction(page, "addItem");
    await itemField(page).fill("salt");
    await review.getByRole("button", { name: "Add", exact: true }).click();
    expect((await ambiguous).status()).toBe(400);
    await expect(review.getByText("Couldn't confidently parse one item. Review and correct before adding.")).toBeVisible();
    await expect(review.getByLabel("Ingredient", { exact: true })).toHaveValue("salt");
    await expect(review.getByLabel("Quantity", { exact: true })).toHaveValue("");
    await expect(review.getByLabel("Unit", { exact: true })).toHaveValue("");
    // The typed text stays for the review; nothing is on the list yet.
    await expect(itemField(page)).toHaveValue("salt");
    await expect(emptyList(page)).toBeVisible();
    await expectAccessible();

    // Confirm it with an amount.
    await review.getByLabel("Quantity", { exact: true }).fill("1");
    await review.getByLabel("Unit", { exact: true }).fill("teaspoon");
    const confirmed = nextShoppingListAction(page, "addItem");
    await review.getByRole("button", { name: "Add", exact: true }).click();
    expect((await confirmed).status()).toBe(200);
    await expect(salt).toContainText("1 teaspoon");
    await expect(review.getByLabel("Quantity", { exact: true })).toBeHidden();
    await expect(itemField(page)).toHaveValue("");
    await expectAccessible();

    await verifyAfterReload(async () => {
      await expect(salt).toContainText("1 teaspoon");
      await expect(view(page, "All", 1)).toBeVisible();
    });
  });

  test("two rows tapped in quick succession both stick, then Clear checked and Clear all empty the list @mutates", async ({
    page,
    verifyAfterReload,
    expectAccessible,
  }) => {
    test.setTimeout(120_000);
    await startWithAnEmptyList(page);
    const onions = row(page, "onions");
    const carrots = row(page, "carrots");
    await addByHand(page, "2 onions", "onions", "2 whole");
    await addByHand(page, "3 carrots", "carrots", "3 whole");

    // Check both, back to back. Each tap must reach the server; a cancelled request never gets a
    // response, and its row would flip back once the list reloads (ui-map bug 11).
    const toggles = recordShoppingListActions(page, "toggleCheck");
    await onions.click();
    await carrots.click();
    await expect(onions).toHaveAttribute("aria-checked", "true");
    await expect(carrots).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => toggles).toEqual([200, 200]);
    await expect(onions).toHaveAttribute("aria-checked", "true");
    await expect(carrots).toHaveAttribute("aria-checked", "true");
    await expect(view(page, "Basket", 2)).toBeVisible();

    await verifyAfterReload(async () => {
      await expect(onions).toHaveAttribute("aria-checked", "true");
      await expect(carrots).toHaveAttribute("aria-checked", "true");
      await expect(view(page, "Basket", 2)).toBeVisible();
    });

    // And uncheck both, back to back.
    await waitForHydration(page);
    await onions.click();
    await carrots.click();
    await expect(onions).toHaveAttribute("aria-checked", "false");
    await expect(carrots).toHaveAttribute("aria-checked", "false");
    await expect.poll(() => toggles).toEqual([200, 200, 200, 200]);
    await expect(onions).toHaveAttribute("aria-checked", "false");
    await expect(carrots).toHaveAttribute("aria-checked", "false");
    await expect(view(page, "Need", 2)).toBeVisible();

    await verifyAfterReload(async () => {
      await expect(onions).toHaveAttribute("aria-checked", "false");
      await expect(carrots).toHaveAttribute("aria-checked", "false");
      await expect(view(page, "Need", 2)).toBeVisible();
    });

    // Clear checked takes only the checked row.
    await waitForHydration(page);
    const checked = nextShoppingListAction(page, "toggleCheck");
    await onions.click();
    await expect(onions).toHaveAttribute("aria-checked", "true");
    expect((await checked).status()).toBe(200);
    await page.getByRole("button", { name: "Clear checked", exact: true }).click();
    await expect(onions).toBeHidden();
    await expect(carrots).toContainText("3 whole");
    await expect(view(page, "All", 1)).toBeVisible();

    await verifyAfterReload(async () => {
      await expect(onions).toBeHidden();
      await expect(carrots).toContainText("3 whole");
      await expect(view(page, "All", 1)).toBeVisible();
    });

    // Clear all asks first; "Keep list" keeps it.
    await waitForHydration(page);
    await page.getByRole("button", { name: "Clear all", exact: true }).click();
    const dialog = page.getByRole("alertdialog", { name: "Start fresh?" });
    await expect(dialog).toBeVisible();
    await expectAccessible();
    await dialog.getByRole("button", { name: "Keep list", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(carrots).toBeVisible();

    await clearAll(page);
    await expect(carrots).toBeHidden();

    await verifyAfterReload(async () => {
      await expect(emptyList(page)).toBeVisible();
      await expect(carrots).toBeHidden();
    });
  });
});
