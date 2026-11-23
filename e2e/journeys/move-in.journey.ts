// Move in on both devices, as scratch user 11's per-device twins (AGENTS.md's scratch index table):
// for each source app version the move-in proof seeds, drop that version's small kitchen backup on
// /move-in, close the page once it starts, and come back when the server has moved it all in: the
// finish screen must match the proof's manifest, every recipe and every photo it counted. Then drop the same backup again and see nothing come in
// twice, and find one of its recipes, photo and all, in the person's kitchen. The backups and the
// manifest are the published proof fixtures (scripts/move-in-proof, release
// move-in-proof-fixtures-v1), read from the public release and checked against pinned digests.
//
// The two devices sign in as different accounts, so neither sees the other's recipes, and each
// version's kitchen is its own source with its own ids (checked below), so the three versions
// never collide: a later version's recipes get a "(2)" or "(3)" after a title the account already
// has, which also makes those move-ins finish with something to look over.
import { test, expect } from "./support/journey";
import type { Page } from "@playwright/test";
import { bytesSource, openZip } from "../../app/domains/move-in/adapters/archive/zip";
import { openMealieBackup } from "../../app/domains/move-in/adapters/sources/mealie-backup/backup";
import { chooseGroup, recipeDrafts } from "../../app/domains/move-in/adapters/sources/mealie-backup/database";
import { requiredLabel } from "./support/forms";
import { download } from "./support/move-in-fixtures";
import { scratchStorageStateForProject } from "./support/personas";

const SCRATCH_INDEX = 11;
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
/** Every recipe title in each version's kitchen. */
const titles = new Map<string, Set<string>>();

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
    titles.set(source.version, new Set(drafts.map((draft) => draft.title)));
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

type JourneyArgs = Pick<Parameters<Parameters<typeof test>[2]>[0], "page" | "expectAccessible">;

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
async function moveIn(version: string, { page, expectAccessible }: JourneyArgs): Promise<() => Promise<void>> {
  test.setTimeout(3 * MOVE_IN_MS);
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
  const move = page.url();
  // A small kitchen can finish before the page shows it moving, so progress is captured only when it shows.
  const moving = main.getByRole("heading", { level: 2, name: "Moving in", exact: true });
  if (await moving.isVisible()) await snapshot(page, version, "2-progress");

  // Close the page: from here nothing in the browser asks the move-in to go on. Reading the page's
  // HTML never runs or queues it, so the server alone has to finish it before the person comes back.
  await page.goto("about:blank");
  const done = new RegExp(`${recipes}(?:<!-- -->)? recipes moved in`);
  await expect(async () => {
    expect(await (await page.request.get(move)).text()).toMatch(done);
  }).toPass({ timeout: MOVE_IN_MS, intervals: [3_000] });
  await page.goto(move);

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

/** Moves the same backup in again: every recipe and photo is already here, so nothing comes in twice. */
async function moveInAgain(version: string, { page }: Pick<JourneyArgs, "page">) {
  const { recipes, recipesWithPhoto } = (await fixtures()).kitchens.small.counts;
  const main = page.getByRole("main");
  await main.getByRole("link", { name: "Move in another backup", exact: true }).click();
  await dropBackup(page, version);
  await expect(main.getByRole("heading", { level: 2, name: "Nothing new to move in", exact: true })).toBeVisible({ timeout: MOVE_IN_MS });
  await expect(detail(page, "Already here")).toHaveText(String(recipes));
  await expect(detail(page, "Photos")).toHaveText(`${recipesWithPhoto} of ${recipesWithPhoto}`);
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Finds the version's sample recipe in the person's kitchen and opens it to see its photo. Kitchens
 * can share titles, so the account holds one copy ("Title", "Title (2)", ...) for each version moved
 * in so far that has the recipe. Any copy will do for the photo: each came in with one.
 */
async function inTheKitchen(version: string, { page }: Pick<JourneyArgs, "page">) {
  const { sources } = await fixtures();
  const title = samples.get(version) as string;
  const upTo = sources.slice(0, sources.findIndex((source) => source.version === version) + 1);
  const movedIn = upTo.filter((source) => titles.get(source.version)?.has(title)).length;
  const main = page.getByRole("main");
  await main.getByRole("link", { name: "See your recipes", exact: true }).click();
  await expect(page).toHaveURL(/\/my-recipes/);
  await page.goto(`/my-recipes?q=${encodeURIComponent(title)}`);
  const copies = main.locator(`a[href^="/recipes/"]`).filter({ hasText: title });
  await expect.poll(() => copies.count()).toBeGreaterThanOrEqual(movedIn);
  await copies.first().click();
  const heading = main.getByRole("heading", { level: 1, name: new RegExp(`^${escaped(title)}( \\(\\d+\\))?$`) });
  await expect(heading).toBeVisible();
  const name = (await heading.textContent())?.trim() ?? title;
  const photo = main.getByRole("img", { name: `Photo of ${name}`, exact: true });
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  // Its steps came over too, in order, with the ingredients each one uses linked to it.
  await expect(main.getByRole("heading", { level: 2, name: "Steps", exact: true })).toBeVisible();
  await expect(main.getByRole("article", { name: "Step 1", exact: true })).toBeVisible();
  await expect(main.getByRole("article", { name: /^Step \d+$/ }).getByRole("checkbox").first()).toBeVisible();
  await snapshot(page, version, "4-recipe");
}

test.describe("Move in", () => {
  test.use({ storageState: scratchStorageStateForProject(SCRATCH_INDEX) });

  test("a v1.12.0 kitchen moves in with every recipe and photo, and moving it in again adds nothing @mutates", async ({ page, expectAccessible, verifyAfterReload }) => {
    await verifyAfterReload(await moveIn("v1.12.0", { page, expectAccessible }));
    await moveInAgain("v1.12.0", { page });
    await inTheKitchen("v1.12.0", { page });
  });

  test("a v2.8.0 kitchen moves in with every recipe and photo, and moving it in again adds nothing @mutates", async ({ page, expectAccessible, verifyAfterReload }) => {
    await verifyAfterReload(await moveIn("v2.8.0", { page, expectAccessible }));
    await moveInAgain("v2.8.0", { page });
    await inTheKitchen("v2.8.0", { page });
  });

  test("a v3.31.0 kitchen moves in with every recipe and photo, and moving it in again adds nothing @mutates", async ({ page, expectAccessible, verifyAfterReload }) => {
    await verifyAfterReload(await moveIn("v3.31.0", { page, expectAccessible }));
    await moveInAgain("v3.31.0", { page });
    await inTheKitchen("v3.31.0", { page });
  });
});
