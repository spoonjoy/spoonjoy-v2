import { test, expect } from "../fixtures";
import { randomBytes } from "node:crypto";
import { Secret, fillSecret } from "../journeys/support/secret";
import { requiredLabel } from "../journeys/support/forms";
import { proofFixtures } from "../journeys/support/move-in-fixtures";

// A move-in on a self-hosted server runs as background jobs on the server's in-process JOBS queue
// (self-host/config.mjs, app/domains/move-in/adapters/worker/move-in-job.server.ts). The Self-host
// Image workflow starts a fresh server with the move_in flag on and sets SPOONJOY_SELF_HOST_MOVE_IN;
// without it, this is skipped. It then reads the server's job keys from a backup to see the jobs ran.
test.describe("A move-in on a self-hosted server", () => {
  test.skip(!process.env.SPOONJOY_SELF_HOST_MOVE_IN, "SPOONJOY_SELF_HOST_MOVE_IN comes from the workflow, with a server that has move-in on");

  test("moves a small kitchen in through the server's jobs, every recipe and photo", async ({ page }, testInfo) => {
    test.setTimeout(5 * 60_000);
    const { manifest, bundle } = await proofFixtures();
    const read = manifest as unknown as {
      kitchens: { small: { counts: { recipes: number; recipesWithPhoto: number } } };
      sources: Array<{ version: string; fixtures: { small: { backup: string } } }>;
    };
    const source = read.sources.at(-1)!;
    const entry = bundle.get(source.fixtures.small.backup);
    if (!entry) throw new Error(`The proof fixtures have no ${source.fixtures.small.backup}`);
    const backup = Buffer.from(await bundle.read(entry, { maxBytes: 50 * 1024 * 1024 }));
    const { recipes, recipesWithPhoto } = read.kitchens.small.counts;

    const suffix = randomBytes(4).toString("hex");
    await page.goto("/signup");
    await page.getByLabel("Email").first().fill(`cook-${suffix}@example.test`);
    await page.getByLabel("Username").first().fill(`cook${suffix}`);
    const password = new Secret(`Pw-${randomBytes(12).toString("hex")}`);
    await fillSecret(page.getByLabel("Password", { exact: true }).first(), password);
    await fillSecret(page.getByLabel("Confirm Password").first(), password);
    await page.getByRole("button", { name: /sign up/i }).first().click();
    await expect(page).toHaveURL("/");

    await page.goto("/move-in");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1, name: "Bring your kitchen with you." })).toBeVisible();
    // The page offers a server address or a backup; this one moves in from the backup. The choice card's radio is
    // hidden under its label, which takes the click, so the check doesn't wait for the radio itself to take it.
    await main.getByRole("radio", { name: /^From a backup/ }).check({ force: true });
    await expect(main.getByRole("radio", { name: /^From a backup/ })).toBeChecked();
    await page.getByLabel(requiredLabel("Backup zip"), { exact: true }).setInputFiles({ name: `kitchen-${source.version}.zip`, mimeType: "application/zip", buffer: backup });
    await page.getByRole("button", { name: "Move in", exact: true }).click();
    await expect(page).toHaveURL(/\/move-in\?job=movein_/);

    const done = main.getByRole("region", { name: `${recipes} recipes moved in` });
    await expect(done).toBeVisible({ timeout: 4 * 60_000 });
    const detail = (term: string) => done.locator("dt", { hasText: term }).locator("xpath=following-sibling::dd[1]");
    await expect(detail("Recipes moved in")).toHaveText(String(recipes));
    await expect(detail("Photos")).toHaveText(`${recipesWithPhoto} of ${recipesWithPhoto}`);
    await done.scrollIntoViewIfNeeded();
    await done.screenshot({ path: testInfo.outputPath("move-in-finished.png"), animations: "disabled" });
  });
});
