import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { test, expect } from "../fixtures";
import { Secret, fillSecret } from "../journeys/support/secret";
import { requiredLabel } from "../journeys/support/forms";
import { proofFixtures } from "../journeys/support/move-in-fixtures";

// A move-in that the server restarts in the middle of carries on by itself, with nobody on the page.
// The Self-host Image workflow runs this in two halves around a `docker restart`:
// - before: a cook starts moving the large proof kitchen in and leaves as soon as it is accepted, and the workflow
//   kills the server then;
// - after: the move-in finishes with no page open to nudge it. Progress is read with JavaScript off,
//   because the open page asks the server to pick up a stalled move-in, which would hide the bug.
// SPOONJOY_SELF_HOST_MOVE_IN_RESTART picks the half; without it, this is skipped.
const half = process.env.SPOONJOY_SELF_HOST_MOVE_IN_RESTART;
const statePath = process.env.SPOONJOY_SELF_HOST_MOVE_IN_RESTART_STATE ?? ".self-host/move-in-restart.json";
// Files beside the state file, for the workflow to slow the server down just before the cook clicks Move in.
const slowAsked = `${statePath}.slow-asked`;
const slowed = `${statePath}.slowed`;

interface State {
  email: string;
  password: string;
  url: string;
  recipes: number;
}

test.describe("A move-in on a self-hosted server that restarts", () => {
  test.skip(!half, "SPOONJOY_SELF_HOST_MOVE_IN_RESTART comes from the workflow, around a restart of a server with move-in on");

  test("before the restart: a cook starts moving a large kitchen in and leaves", async ({ page }) => {
    test.skip(half !== "before", "the half before the restart");
    test.setTimeout(5 * 60_000);
    const { manifest, bundle } = await proofFixtures();
    const read = manifest as unknown as {
      kitchens: { large: { counts: { recipes: number } } };
      sources: Array<{ version: string; fixtures: { large: { backup: string } } }>;
    };
    const source = read.sources.at(-1)!;
    const entry = bundle.get(source.fixtures.large.backup);
    if (!entry) throw new Error(`The proof fixtures have no ${source.fixtures.large.backup}`);
    const backup = Buffer.from(await bundle.read(entry, { maxBytes: 50 * 1024 * 1024 }));

    const suffix = randomBytes(4).toString("hex");
    const email = `restart-${suffix}@example.test`;
    const plainPassword = `Pw-${randomBytes(12).toString("hex")}`;
    const password = new Secret(plainPassword);
    await page.goto("/signup");
    await page.getByLabel("Email").first().fill(email);
    await page.getByLabel("Username").first().fill(`restart${suffix}`);
    await fillSecret(page.getByLabel("Password", { exact: true }).first(), password);
    await fillSecret(page.getByLabel("Confirm Password").first(), password);
    await page.getByRole("button", { name: /sign up/i }).first().click();
    await expect(page).toHaveURL("/");

    await page.goto("/move-in");
    // The page may ask where the kitchen comes from first; the backup field shows once "From a backup" is picked.
    const fromBackup = page.getByRole("main").getByRole("radio", { name: /^From a backup/ });
    if ((await fromBackup.count()) > 0) await fromBackup.check();
    await page.getByLabel(requiredLabel("Backup zip"), { exact: true }).setInputFiles({ name: `kitchen-${source.version}.zip`, mimeType: "application/zip", buffer: backup });
    // A 500-recipe move-in finishes within a second at full speed, before any kill lands. The workflow caps the
    // server's CPU now, so the move-in is still running when it kills the server, and lifts the cap before it starts again.
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(slowAsked, "");
    await expect.poll(() => existsSync(slowed), { timeout: 60_000 }).toBe(true);
    await page.getByRole("button", { name: "Move in", exact: true }).click();
    // The move-in is accepted. The cook leaves at once, and the state file tells the workflow to kill the server: 500
    // recipes come in within seconds, so it must land at once. The workflow then checks the move-in was unfinished.
    await expect(page).toHaveURL(/\/move-in\?job=movein_/, { timeout: 2 * 60_000 });
    const url = page.url();
    await page.goto("about:blank");
    const recipes = read.kitchens.large.counts.recipes;

    mkdirSync(dirname(statePath), { recursive: true });
    const state: State = { email, password: plainPassword, url, recipes };
    writeFileSync(statePath, JSON.stringify(state));
  });

  test("after the restart: the move-in finishes with nobody on the page", async ({ browser }, testInfo) => {
    test.skip(half !== "after", "the half after the restart");
    test.setTimeout(8 * 60_000);
    const state = JSON.parse(readFileSync(statePath, "utf8")) as State;

    const signIn = await browser.newPage();
    await signIn.goto("/login");
    await signIn.getByLabel("Username or email").first().fill(state.email);
    await fillSecret(signIn.getByLabel("Password", { exact: true }).first(), new Secret(state.password));
    await signIn.getByRole("button", { name: "Sign in", exact: true }).click();
    await signIn.waitForURL((url) => url.pathname !== "/login");
    const storageState = await signIn.context().storageState();
    await signIn.close();

    // The server-rendered page only reads the move-in; with JavaScript off it never asks to continue it.
    const reader = await browser.newContext({ storageState, javaScriptEnabled: false });
    const page = await reader.newPage();
    const done = page.getByRole("main").getByRole("region", { name: `${state.recipes} recipes moved in` });
    await expect(async () => {
      await page.goto(state.url);
      await expect(done).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 6 * 60_000, intervals: [10_000] });
    await done.screenshot({ path: testInfo.outputPath("move-in-after-restart.png") });
    await reader.close();
  });
});
