// Moving a kitchen in from another Spoonjoy, for move-in.desktop.journey.ts. Scratch index 16's base account is the
// cook on the other Spoonjoy: through the API, as that cook, the journey puts one recipe in its kitchen, with two
// timed steps, their ingredients and a cover photo. Then, as that cook, it makes the API token docs/self-hosting.md
// (Moving your kitchen) tells a cook to make, on Account settings with Make token. Its desktop twin is the cook moving in: on /move-in it picks Another Spoonjoy, gives
// the other Spoonjoy's address (support/spoonjoy-server.ts) and the token, and finds the recipe, photo and steps in
// its own kitchen after a reload. Moving in again from the same Spoonjoy adds nothing.
import { readFile } from "node:fs/promises";
import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { test, expect } from "./journey";
import { requiredLabel } from "./forms";
import { waitForHydration } from "./app-ready";
import { scratchStorageStatePath } from "./personas";
import { deleteMoveToken, startSpoonjoyServer, type SpoonjoyServer } from "./spoonjoy-server";

const MOVE_IN_MS = 150_000;
const PHOTO = "e2e/fixtures/spoon-test-photo.png";

/** The recipe in the other Spoonjoy's kitchen. */
export const FOCACCIA = {
  title: "Moving-day focaccia",
  steps: [
    { stepTitle: "Dough", description: "Stir the flour, water, yeast and salt into a shaggy dough.", duration: 10, ingredients: [{ quantity: 500, unit: "g", name: "bread flour" }, { quantity: 400, unit: "ml", name: "warm water" }] },
    { stepTitle: null, description: "Dimple the risen dough with olive oil and bake until golden.", duration: 25, ingredients: [{ quantity: 3, unit: "tbsp", name: "olive oil" }] },
  ],
};

/** Puts FOCACCIA, with its cover photo, in the kitchen of the cook the request context is signed in as. */
async function fillKitchen(cook: APIRequestContext) {
  const origin = { origin: new URL(process.env.SPOONJOY_JOURNEYS_BASE_URL as string).origin };
  const run = `journey-move-${Date.now()}`;
  const created = await cook.post("/api/v1/recipes", {
    headers: origin,
    data: { clientMutationId: `${run}-recipe`, title: FOCACCIA.title, description: "A tray bake that travels.", servings: "8", steps: FOCACCIA.steps },
  });
  expect(created.status(), "putting the recipe in the other Spoonjoy's kitchen").toBe(201);
  const recipeId = ((await created.json()) as { data: { recipe: { id: string } } }).data.recipe.id;
  const photo = await cook.post(`/api/v1/recipes/${recipeId}/image`, {
    headers: origin,
    multipart: {
      clientMutationId: `${run}-photo`,
      photo: { name: "focaccia.png", mimeType: "image/png", buffer: await readFile(PHOTO) },
      activateWhenReady: "true",
      generateEditorial: "false",
    },
  });
  expect(photo.status(), "giving the recipe its cover photo").toBe(201);
}

/**
 * Makes a move-in token on Account settings, as the cook on the other Spoonjoy does: Make token, for moving a kitchen,
 * under a name of its own. The token is shown once; after a reload it is listed by name and its secret is gone. It is
 * deleted when the test ends, before the run's report is uploaded, and the run's Worker and database go with the run.
 */
async function makeMoveToken(browser: Browser, baseURL: string | undefined): Promise<{ token: string; name: string }> {
  const name = `Moving my kitchen ${Date.now()}`;
  const context = await browser.newContext({ baseURL, storageState: scratchStorageStatePath(16) });
  try {
    const page = await context.newPage();
    await page.goto("/account/settings");
    await waitForHydration(page);
    const form = page.getByTestId("make-api-token");
    await expect(form.getByRole("radio", { name: "Moving my kitchen to another Spoonjoy" })).toBeChecked();
    await form.getByRole("textbox", { name: "Name" }).fill(name);
    await form.getByRole("button", { name: "Make token" }).click();
    const section = page.getByTestId("api-access-section");
    await expect(section.getByText(`${name} is ready`)).toBeVisible();
    const token = ((await section.locator("pre").textContent()) ?? "").trim();
    expect(token.startsWith("sj_"), "the token Make token showed").toBe(true);
    await page.reload();
    await expect(section.getByRole("button", { name: `Revoke ${name}`, exact: true })).toBeVisible();
    await expect(section.locator("pre"), "the secret, shown only once").toHaveCount(0);
    return { token, name };
  } finally {
    await context.close();
  }
}

/**
 * The journey test with `otherSpoonjoy`: scratch index 16's base account, with FOCACCIA in its kitchen and a move-in
 * token made on Account settings, reached through the run's Move in stand-in. It closes in the test's teardown, which runs even when the test times out.
 */
// Setting up fills a kitchen, reads it back and loads it into the stand-in, each with a few tries, so the fixture has
// its own time rather than the test's 60 s.
const SETUP_MS = 4 * 60_000;

export const spoonjoyTest = test.extend<{ otherSpoonjoy: SpoonjoyServer }>({
  otherSpoonjoy: [async ({ playwright, browser, baseURL }, use) => {
    const cook = await playwright.request.newContext({ baseURL, storageState: scratchStorageStatePath(16) });
    let server: SpoonjoyServer | null = null;
    let made: { token: string; name: string } | null = null;
    try {
      await fillKitchen(cook);
      made = await makeMoveToken(browser, baseURL);
      server = await startSpoonjoyServer(made.token);
      await use(server);
    } finally {
      await server?.close();
      if (made) await deleteMoveToken(cook, made.name);
      await cook.dispose();
    }
  }, { timeout: SETUP_MS }],
});

function detail(page: Page, term: string) {
  return page.getByRole("main").locator("dt", { hasText: term }).locator("xpath=following-sibling::dd[1]");
}

/** Picks Another Spoonjoy by tapping its card, gives the other Spoonjoy's address and token, and starts the move-in. */
async function moveInFrom(page: Page, server: SpoonjoyServer) {
  const main = page.getByRole("main");
  await page.goto("/move-in");
  await expect(main.getByRole("heading", { level: 1, name: "Bring your kitchen with you." })).toBeVisible();
  await main.getByText("Another Spoonjoy", { exact: true }).click();
  await expect(main.getByRole("radio", { name: /^Another Spoonjoy/ })).toBeChecked();
  // Another Spoonjoy moves in only from its server, so the page asks for no backup.
  await expect(main.getByRole("radio", { name: /^From a backup/ })).toHaveCount(0);
  await main.getByLabel(requiredLabel("Server address"), { exact: true }).fill(server.address);
  await main.getByLabel(requiredLabel("API token"), { exact: true }).fill(server.token);
  await main.getByRole("button", { name: "Move in", exact: true }).click();
  await expect(page).toHaveURL(/\/move-in\?job=movein_/, { timeout: 60_000 });
}

/** Moves the other Spoonjoy's kitchen in. Returns the finish screen's check, for the test to run again after a reload. */
export async function moveInFromSpoonjoy(page: Page, server: SpoonjoyServer): Promise<() => Promise<void>> {
  test.setTimeout(Math.max(test.info().timeout, 3 * MOVE_IN_MS));
  const main = page.getByRole("main");
  await moveInFrom(page, server);
  const finished = async () => {
    await expect(main.getByRole("heading", { level: 2, name: "1 recipe moved in", exact: true })).toBeVisible({ timeout: MOVE_IN_MS });
    await expect(detail(page, "Recipes moved in")).toHaveText("1");
    await expect(detail(page, "Photos")).toHaveText("1 of 1");
    await expect(main.getByText(/stayed (in the backup|on your recipe server|on your other Spoonjoy)/)).toHaveCount(0);
  };
  await finished();
  // It read the other Spoonjoy's export, and the photo from that Spoonjoy's own photo store.
  const asked = await server.asked();
  expect(asked.get("/api/v1/me/export") ?? 0).toBeGreaterThan(0);
  expect([...asked.keys()].some((path) => path.startsWith("/photos/"))).toBe(true);
  return finished;
}

/** Moves the same kitchen in again from the same Spoonjoy: its recipe is already here, so nothing comes in twice. */
export async function moveInFromSpoonjoyAgain(page: Page, server: SpoonjoyServer): Promise<() => Promise<void>> {
  const main = page.getByRole("main");
  await main.getByRole("link", { name: "Move in again", exact: true }).click();
  await moveInFrom(page, server);
  return async () => {
    await expect(main.getByRole("heading", { level: 2, name: "Everything was already here", exact: true })).toBeVisible({ timeout: MOVE_IN_MS });
    await expect(main.getByText("1 already here, 0 changed.", { exact: true })).toBeVisible();
  };
}

/** Finds the recipe in the cook's kitchen once, under its own name, with its photo, steps and ingredients, after a reload. */
export async function focacciaInTheKitchen(page: Page, verifyAfterReload: (check: () => Promise<void>) => Promise<void>) {
  const main = page.getByRole("main");
  await page.goto(`/my-recipes?q=${encodeURIComponent(FOCACCIA.title)}`);
  const copies = main.locator(`a[href^="/recipes/"]`).filter({ hasText: FOCACCIA.title });
  await expect(copies).toHaveCount(1);
  const href = await copies.first().getAttribute("href");
  expect(href, "the recipe's link in the kitchen").toMatch(/^\/recipes\/[^/?#]+$/);
  // A click before hydration can go nowhere (run 45889138153), so the cook's click comes once the page is live.
  await waitForHydration(page);
  await copies.first().click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(main.getByRole("heading", { level: 1, name: FOCACCIA.title, exact: true })).toBeVisible();
  await verifyAfterReload(async () => {
    await expect(main.getByRole("heading", { level: 1, name: FOCACCIA.title, exact: true })).toBeVisible();
    const photo = main.getByRole("img", { name: `Photo of ${FOCACCIA.title}`, exact: true });
    await expect(photo).toBeVisible();
    await expect.poll(() => photo.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    // A step is named by its title, and an untitled one by its number, so the first step keeps its title "Dough".
    const dough = main.getByRole("article", { name: "Dough", exact: true });
    await expect(dough).toContainText("Step 1");
    await expect(dough).toContainText(FOCACCIA.steps[0].description);
    await expect(dough).toContainText("bread flour");
    await expect(dough).toContainText("10 min");
    const bake = main.getByRole("article", { name: "Step 2", exact: true });
    await expect(bake).toContainText(FOCACCIA.steps[1].description);
    await expect(bake).toContainText("25 min");
  });
}
