// Move in on both devices, as scratch user 9's per-device twins (AGENTS.md's scratch index table):
// for each source app version the move-in proof seeds, drop that version's small kitchen backup on
// /move-in, watch it move in, and check the finish screen against the proof's manifest: every
// recipe and every photo it counted. Then drop the same backup again and see nothing come in
// twice. The backups and the manifest are the published proof fixtures
// (scripts/move-in-proof, release move-in-proof-fixtures-v1), read from the public release.
//
// The two devices sign in as different accounts, so neither sees the other's recipes, and each
// version's kitchen is its own source with its own ids, so the three versions never collide: a
// later version's recipes may only get a "(2)" after a title the account already has.
import { test, expect } from "./support/journey";
import type { Page } from "@playwright/test";
import { bytesSource, openZip } from "../../app/domains/move-in/adapters/archive/zip";
import { requiredLabel } from "./support/forms";
import { scratchStorageStateForProject } from "./support/personas";

const SCRATCH_INDEX = 9;
const RELEASE = "https://github.com/spoonjoy/spoonjoy-v2/releases/download/move-in-proof-fixtures-v1";
// A move-in of a small kitchen polls every few seconds; give it room on a slow QA run.
const MOVE_IN_MS = 150_000;

interface Manifest {
  kitchens: { small: { counts: { recipes: number; recipesWithPhoto: number } } };
  sources: Array<{ version: string; fixtures: { small: { backup: string } } }>;
}

let manifest: Manifest | undefined;
const backups = new Map<string, Buffer>();

async function download(name: string): Promise<Uint8Array> {
  const response = await fetch(`${RELEASE}/${name}`);
  if (!response.ok) throw new Error(`The proof fixture ${name} answered ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** The manifest and each version's small kitchen backup, read once per worker. */
async function fixtures(): Promise<Manifest> {
  if (manifest) return manifest;
  const read = JSON.parse(new TextDecoder().decode(await download("manifest.json"))) as Manifest;
  const bundle = await openZip(bytesSource(await download("move-in-proof-fixtures.zip")));
  for (const source of read.sources) {
    const entry = bundle.get(source.fixtures.small.backup);
    if (!entry) throw new Error(`The proof fixtures have no ${source.fixtures.small.backup}`);
    backups.set(source.version, Buffer.from(await bundle.read(entry, { maxBytes: 50 * 1024 * 1024 })));
  }
  manifest = read;
  return read;
}

function detail(page: Page, term: string) {
  return page.getByRole("main").locator("dt", { hasText: term }).locator("xpath=following-sibling::dd[1]");
}

async function dropBackup(page: Page, version: string) {
  await page.getByLabel(requiredLabel("Backup zip"), { exact: true }).setInputFiles({
    name: `kitchen-${version}.zip`,
    mimeType: "application/zip",
    buffer: backups.get(version) as Buffer,
  });
  await page.getByRole("button", { name: "Move in", exact: true }).click();
  await expect(page).toHaveURL(/\/move-in\?job=movein_/);
}

type JourneyArgs = Parameters<Parameters<typeof test>[2]>[0];

/**
 * Moves the version's small kitchen in and checks the finish screen against the manifest. Returns
 * that check, for the test to run again after a reload.
 */
async function moveIn(version: string, { page, expectAccessible }: JourneyArgs): Promise<() => Promise<void>> {
  test.setTimeout(2 * MOVE_IN_MS + 60_000);
  const { kitchens, sources } = await fixtures();
  expect(sources.map((source) => source.version)).toContain(version);
  const { recipes, recipesWithPhoto } = kitchens.small.counts;
  const main = page.getByRole("main");

  await page.goto("/move-in");
  await expect(main.getByRole("heading", { level: 1, name: "Bring your kitchen with you." })).toBeVisible();
  await expect(main.getByRole("radio", { name: /^Mealie/ })).toBeChecked();
  await expectAccessible();

  await dropBackup(page, version);
  const finished = async () => {
    await expect(main.getByRole("heading", { level: 2, name: `${recipes} recipes moved in`, exact: true })).toBeVisible({ timeout: MOVE_IN_MS });
    await expect(detail(page, "Recipes moved in")).toHaveText(String(recipes));
    await expect(detail(page, "Photos")).toHaveText(`${recipesWithPhoto} of ${recipesWithPhoto}`);
  };
  await finished();
  await expectAccessible();
  return finished;
}

/** Moves the same backup in again: every recipe and photo is already here, so nothing comes in twice. */
async function moveInAgain(version: string, { page }: JourneyArgs) {
  const { recipes, recipesWithPhoto } = (await fixtures()).kitchens.small.counts;
  const main = page.getByRole("main");
  await main.getByRole("link", { name: "Move in another backup", exact: true }).click();
  await dropBackup(page, version);
  await expect(main.getByRole("heading", { level: 2, name: "Nothing new to move in", exact: true })).toBeVisible({ timeout: MOVE_IN_MS });
  await expect(detail(page, "Already here")).toHaveText(String(recipes));
  await expect(detail(page, "Photos")).toHaveText(`${recipesWithPhoto} of ${recipesWithPhoto}`);
}

test.describe("Move in", () => {
  test.use({ storageState: scratchStorageStateForProject(SCRATCH_INDEX) });

  test("a v1.12.0 kitchen moves in with every recipe and photo, and moving it in again adds nothing @mutates", async (args) => {
    const { verifyAfterReload } = args;
    await verifyAfterReload(await moveIn("v1.12.0", args));
    await moveInAgain("v1.12.0", args);
  });

  test("a v2.8.0 kitchen moves in with every recipe and photo, and moving it in again adds nothing @mutates", async (args) => {
    const { verifyAfterReload } = args;
    await verifyAfterReload(await moveIn("v2.8.0", args));
    await moveInAgain("v2.8.0", args);
  });

  test("a v3.31.0 kitchen moves in with every recipe and photo, and moving it in again adds nothing @mutates", async (args) => {
    const { verifyAfterReload } = args;
    await verifyAfterReload(await moveIn("v3.31.0", args));
    await moveInAgain("v3.31.0", args);
  });
});
