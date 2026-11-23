// Moving a kitchen in, for the Move in journeys (move-in.mobile.journey.ts, move-in.desktop.journey.ts):
// drop a source version's small kitchen backup on /move-in, watch it move in, and check the finish
// screen against the move-in proof's manifest; move the same backup in again and see nothing added;
// find one of its recipes, photo and steps and all, in the kitchen. The backups and the manifest are
// the published proof fixtures (scripts/move-in-proof, release move-in-proof-fixtures-v1), read from
// the public release and checked against pinned digests. Each version's kitchen has its own ids
// (checked below), and each journey moves into its own fresh scratch account.
import type { Page } from "@playwright/test";
import { test, expect } from "./journey";
import { bytesSource, openZip } from "../../../app/domains/move-in/adapters/archive/zip";
import { openMealieBackup } from "../../../app/domains/move-in/adapters/sources/mealie-backup/backup";
import { chooseGroup, recipeDrafts } from "../../../app/domains/move-in/adapters/sources/mealie-backup/database";
import { requiredLabel } from "./forms";
import { download } from "./move-in-fixtures";

// A move-in of a small kitchen polls every few seconds; give it room on a slow QA run.
const MOVE_IN_MS = 150_000;

interface Manifest {
  kitchens: { small: { counts: { recipes: number; recipesWithPhoto: number } } };
  sources: Array<{ version: string; fixtures: { small: { backup: string } } }>;
}

let manifest: Manifest | undefined;
const backups = new Map<string, Buffer>();
/** One recipe with a photo from each version's kitchen, to find after it moves in. */
const samples = new Map<string, string>();

/** The manifest and each version's small kitchen backup, read once per worker. */
async function fixtures(): Promise<Manifest> {
  if (manifest) return manifest;
  const groups = new Set<string>();
  const read = JSON.parse(new TextDecoder().decode(await download("manifest.json"))) as Manifest;
  const bundle = await openZip(bytesSource(await download("move-in-proof-fixtures.zip")));
  for (const source of read.sources) {
    const entry = bundle.get(source.fixtures.small.backup);
    if (!entry) throw new Error(`The proof fixtures have no ${source.fixtures.small.backup}`);
    const bytes = await bundle.read(entry, { maxBytes: 50 * 1024 * 1024 });
    backups.set(source.version, Buffer.from(bytes));
    const backup = await openMealieBackup(bytesSource(bytes));
    const group = chooseGroup(backup.database, null) as string;
    groups.add(group);
    const drafts = recipeDrafts(backup.database, group);
    const sample = drafts.find((draft) => backup.hasFile(draft.photoPath));
    if (!sample) throw new Error(`The ${source.version} kitchen has no recipe with a photo`);
    samples.set(source.version, sample.title);
  }
  if (groups.size !== read.sources.length) throw new Error("Two proof kitchens share a kitchen id, so they would move in as one");
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

export type JourneyArgs = Pick<Parameters<Parameters<typeof test>[2]>[0], "page" | "expectAccessible">;

/** Attaches a full-page screenshot to the report, named for the version, so a reviewer can see each state. */
async function snapshot(page: Page, version: string, state: string) {
  await test.info().attach(`move-in-${version}-${state}`, {
    body: await page.screenshot({ fullPage: true, animations: "disabled" }),
    contentType: "image/png",
  });
}

/**
 * Moves the version's small kitchen in and checks the finish screen against the manifest. Returns
 * that check, for the test to run again after a reload.
 */
export async function moveIn(version: string, { page, expectAccessible }: JourneyArgs): Promise<() => Promise<void>> {
  test.setTimeout(Math.max(test.info().timeout, 3 * MOVE_IN_MS));
  const { kitchens, sources } = await fixtures();
  expect(sources.map((source) => source.version)).toContain(version);
  const { recipes, recipesWithPhoto } = kitchens.small.counts;
  const main = page.getByRole("main");

  await page.goto("/move-in");
  await expect(main.getByRole("heading", { level: 1, name: "Bring your kitchen with you." })).toBeVisible();
  await expect(main.getByRole("radio", { name: /^Mealie/ })).toBeChecked();
  await expectAccessible();
  await snapshot(page, version, "1-before-a-file");

  await dropBackup(page, version);
  // A small kitchen can finish before the first poll, so progress is captured only when it shows.
  const moving = main.getByRole("heading", { level: 2, name: "Moving in", exact: true });
  if (await moving.isVisible()) await snapshot(page, version, "2-progress");
  const finished = async () => {
    await expect(main.getByRole("heading", { level: 2, name: `${recipes} recipes moved in`, exact: true })).toBeVisible({ timeout: MOVE_IN_MS });
    await expect(detail(page, "Recipes moved in")).toHaveText(String(recipes));
    await expect(detail(page, "Photos")).toHaveText(`${recipesWithPhoto} of ${recipesWithPhoto}`);
  };
  await finished();
  await expectAccessible();
  await snapshot(page, version, "3-finished");
  return finished;
}

/**
 * Moves the same backup in again: every recipe and photo is already here, so nothing comes in twice.
 * Returns that check, for the test to run again after a reload.
 */
export async function moveInAgain(version: string, { page }: Pick<JourneyArgs, "page">): Promise<() => Promise<void>> {
  const { recipes, recipesWithPhoto } = (await fixtures()).kitchens.small.counts;
  const main = page.getByRole("main");
  await main.getByRole("link", { name: "Move in another backup", exact: true }).click();
  await dropBackup(page, version);
  const nothingAdded = async () => {
    await expect(main.getByRole("heading", { level: 2, name: "Everything was already here", exact: true })).toBeVisible({ timeout: MOVE_IN_MS });
    await expect(main.getByText(`${recipes} already here, 0 changed.`, { exact: true })).toBeVisible();
    await expect(detail(page, "Recipes moved in")).toHaveText("0");
    await expect(detail(page, "Photos")).toHaveText(`${recipesWithPhoto} of ${recipesWithPhoto}`);
  };
  await nothingAdded();
  await snapshot(page, version, "5-moved-in-again");
  return nothingAdded;
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Finds the version's sample recipe in the person's kitchen, once and under its own name, and opens
 * it to see its photo and steps. Each account moves in one kitchen, so a second copy ("Title (2)")
 * would mean a recipe came in twice.
 */
export async function inTheKitchen(version: string, { page }: Pick<JourneyArgs, "page">) {
  await fixtures();
  const title = samples.get(version) as string;
  const main = page.getByRole("main");
  await main.getByRole("link", { name: "See your recipes", exact: true }).click();
  await expect(page).toHaveURL(/\/my-recipes/);
  await page.goto(`/my-recipes?q=${encodeURIComponent(title)}`);
  const copies = main.locator(`a[href^="/recipes/"]`).filter({ hasText: title });
  await expect(copies.first()).toBeVisible();
  await expect(main.locator(`a[href^="/recipes/"]`).filter({ hasText: new RegExp(`${escaped(title)} \\(\\d+\\)`) })).toHaveCount(0);
  await copies.first().click();
  const heading = main.getByRole("heading", { level: 1, name: title, exact: true });
  await expect(heading).toBeVisible();
  const photo = main.getByRole("img", { name: `Photo of ${title}`, exact: true });
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  // Its steps came over too, in order, with the ingredients each one uses linked to it.
  await expect(main.getByRole("heading", { level: 2, name: "Steps", exact: true })).toBeVisible();
  await expect(main.getByRole("article", { name: "Step 1", exact: true })).toBeVisible();
  await expect(main.getByRole("article", { name: /^Step \d+$/ }).getByRole("checkbox").first()).toBeVisible();
  await snapshot(page, version, "4-recipe");
}
