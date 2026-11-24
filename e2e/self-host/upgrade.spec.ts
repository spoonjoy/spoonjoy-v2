import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { test, expect } from "../fixtures";
import { waitForHydration } from "../journeys/support/app-ready";
import { Secret, fillSecret } from "../journeys/support/secret";

// Updating a server: the Self-host Image workflow starts the last published image with Docker
// Compose, runs the "before" half here, moves the same Compose project to this commit's image, and
// runs the "after" half. SPOONJOY_SELF_HOST_UPGRADE names the half, and SPOONJOY_SELF_HOST_UPGRADE_STATE
// is the file the halves share (a synthetic owner, made here). Without them, this is skipped.
const half = process.env.SPOONJOY_SELF_HOST_UPGRADE;
const statePath = process.env.SPOONJOY_SELF_HOST_UPGRADE_STATE ?? "";

interface UpgradeState {
  email: string;
  password: string;
  title: string;
  url: string;
}

test.describe("Updating a self-hosted server", () => {
  test.skip(!half || !statePath, "SPOONJOY_SELF_HOST_UPGRADE and its state file come from the workflow");

  test("before: its owner signs up, adds a recipe and opens sign-ups", async ({ page }, testInfo) => {
    test.skip(half !== "before", "The before half runs on the last published image");
    const suffix = randomBytes(4).toString("hex");
    // Synthetic, made for this run; the after half signs in with it from the shared state file.
    const plainPassword = `Pw-${randomBytes(12).toString("hex")}`;
    const password = new Secret(plainPassword);
    const email = `owner-${suffix}@example.test`;
    await page.goto("/signup");
    await page.getByLabel("Email").first().fill(email);
    await page.getByLabel("Username").first().fill(`owner${suffix}`);
    await fillSecret(page.getByLabel("Password", { exact: true }).first(), password);
    await fillSecret(page.getByLabel("Confirm Password").first(), password);
    await page.getByRole("button", { name: /sign up/i }).first().click();
    await expect(page).toHaveURL("/");

    const title = `Upgrade Soup ${suffix}`;
    await page.goto("/recipes/new");
    await waitForHydration(page);
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.getByRole("button", { name: "Add step", exact: true }).click();
    const step = page.getByRole("article", { name: "Step 1", exact: true });
    await step.getByLabel("Instructions").fill("Simmer the stock until it smells like home");
    await step.getByRole("textbox", { name: "Ingredient text" }).fill("1 quart chicken stock");
    await expect(step.getByRole("button", { name: "Remove chicken stock" })).toBeVisible();
    await page.getByRole("button", { name: "Create recipe", exact: true }).click();
    await expect(page).toHaveURL(/\/recipes\/(?!new$)[^/?#]+$/);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    const url = new URL(page.url()).pathname;

    await page.goto("/account/server");
    await page.getByRole("button", { name: "Open sign-ups" }).click();
    await expect(page.getByTestId("server-signups-mode")).toHaveText("Open");
    await page.getByTestId("server-signups").screenshot({ path: testInfo.outputPath("upgrade-before-signups.png") });

    mkdirSync(dirname(statePath), { recursive: true });
    const state: UpgradeState = { email, password: plainPassword, title, url };
    writeFileSync(statePath, JSON.stringify(state));
  });

  test("after: the owner signs back in and finds the recipe and the setting", async ({ page }, testInfo) => {
    test.skip(half !== "after", "The after half runs on this commit's image");
    const state = JSON.parse(readFileSync(statePath, "utf8")) as UpgradeState;
    await page.goto("/login");
    await page.getByLabel("Username or email").first().fill(state.email);
    await fillSecret(page.getByLabel("Password", { exact: true }).first(), new Secret(state.password));
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((url) => url.pathname !== "/login");

    await page.goto(state.url);
    await page.reload();
    const heading = page.getByRole("heading", { level: 1, name: state.title });
    await expect(heading).toBeVisible();
    await expect(page.getByText("Simmer the stock until it smells like home")).toBeVisible();
    await expect(page.locator("#steps").getByRole("checkbox", { name: /chicken stock/ })).toBeVisible();
    const main = page.getByRole("main");
    await main.scrollIntoViewIfNeeded();
    await main.screenshot({ path: testInfo.outputPath("upgrade-after-recipe.png") });

    await page.goto("/account/server");
    await page.reload();
    await expect(page.getByTestId("server-signups-mode")).toHaveText("Open");
    const signups = page.getByTestId("server-signups");
    await signups.scrollIntoViewIfNeeded();
    await signups.screenshot({ path: testInfo.outputPath("upgrade-after-signups.png") });
  });
});
