// Moving a kitchen in, for the Move in journeys (move-in.mobile.journey.ts, move-in.desktop.journey.ts):
// drop a source version's small kitchen backup on /move-in, watch it move in, and check the finish
// screen against the move-in proof's manifest, with the kitchen's tags, categories and tools counted;
// move the same backup in again and see nothing added; find one of its recipes, photo, steps, tags
// and all, in the kitchen. The backups and the manifest are
// the published proof fixtures (scripts/move-in-proof, release move-in-proof-fixtures-v1), read from
// the public release and checked against the pinned manifest. Each version's kitchen has its own ids
// (checked below), and each journey moves into its own fresh scratch account.
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./journey";
import { bytesSource } from "../../../app/domains/move-in/adapters/archive/zip";
import { openMealieBackup } from "../../../app/domains/move-in/adapters/sources/mealie-backup/backup";
import { chooseGroup, inspectGroup, recipeDrafts } from "../../../app/domains/move-in/adapters/sources/mealie-backup/database";
import { requiredLabel } from "./forms";
import { chooseMenuItem } from "./menu";
import { pathUrl, waitForHydration } from "./navigation";
import { proofFixtures } from "./move-in-fixtures";

// A move-in of a small kitchen polls every few seconds; give it room on a slow QA run.
const MOVE_IN_MS = 150_000;

interface Manifest {
  kitchens: { small: { counts: { recipes: number; recipesWithPhoto: number } } };
  sources: Array<{ version: string; fixtures: { small: { backup: string } } }>;
}

let manifest: Manifest | undefined;
const backups = new Map<string, Buffer>();
/** One recipe with a photo and tags from each version's kitchen, to find after it moves in. */
const samples = new Map<string, { title: string; tags: string[]; categories: string[]; tools: string[] }>();
/** Each version's kitchen's tags, categories and tools, as the finish screen counts them. */
const organizerCounts = new Map<string, { tags: number; categories: number; tools: number }>();

/** The manifest and each version's small kitchen backup, read once per worker. */
async function fixtures(): Promise<Manifest> {
  if (manifest) return manifest;
  const groups = new Set<string>();
  const fixtures = await proofFixtures();
  const read = fixtures.manifest as unknown as Manifest;
  const bundle = fixtures.bundle;
  for (const source of read.sources) {
    const entry = bundle.get(source.fixtures.small.backup);
    if (!entry) throw new Error(`The proof fixtures have no ${source.fixtures.small.backup}`);
    const bytes = await bundle.read(entry, { maxBytes: 50 * 1024 * 1024 });
    backups.set(source.version, Buffer.from(bytes));
    const backup = await openMealieBackup(bytesSource(bytes));
    const group = chooseGroup(backup.database, null) as string;
    groups.add(group);
    const drafts = recipeDrafts(backup.database, group);
    const sample = drafts.find((draft) => backup.hasFile(draft.photoPath) && draft.tags.length);
    if (!sample) throw new Error(`The ${source.version} kitchen has no recipe with a photo and tags`);
    samples.set(source.version, { title: sample.title, tags: sample.tags, categories: sample.categories, tools: sample.tools });
    const { tags, categories, tools } = inspectGroup(backup.database, group);
    organizerCounts.set(source.version, { tags, categories, tools });
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

export type JourneyArgs = Pick<Parameters<Parameters<typeof test>[2]>[0], "page" | "expectAccessible" | "verifyAfterReload">;

/**
 * Attaches a screenshot to the report, named for the version, so a reviewer can see each state. On a
 * phone it shows only the screen, as the cook sees it: a full-page shot draws the floating tab bar in
 * the middle of the page, over whatever sits there.
 */
async function snapshot(page: Page, version: string, state: string) {
  await test.info().attach(`move-in-${version}-${state}`, {
    body: await page.screenshot({ fullPage: !test.info().project.use.isMobile, animations: "disabled" }),
    contentType: "image/png",
  });
}

/** Scrolls the control into view and checks nothing, such as the floating tab bar, sits over its middle. */
async function reachable(control: Locator) {
  const onTop = await control.evaluate((element) => {
    element.scrollIntoView({ block: "center" });
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return hit !== null && element.contains(hit);
  });
  expect(onTop, "something covers the middle of the control").toBe(true);
}

/**
 * Moves the version's small kitchen in and checks the finish screen against the manifest. Returns
 * that check, for the test to run again after a reload.
 */
export async function moveIn(version: string, { page, expectAccessible }: Pick<JourneyArgs, "page" | "expectAccessible">): Promise<() => Promise<void>> {
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
    // The tags, categories and tools came over with the recipes (organizers are on in QA), so none stayed behind.
    const organizers = organizerCounts.get(version) as { tags: number; categories: number; tools: number };
    for (const [term, count] of [["Tags", organizers.tags], ["Categories", organizers.categories], ["Tools", organizers.tools]] as const) {
      if (count) await expect(detail(page, term)).toHaveText(String(count));
      else await expect(main.locator("dt", { hasText: term })).toHaveCount(0);
    }
    await expect(main.getByText(/stayed in the backup/)).toHaveCount(0);
  };
  await finished();
  await expectAccessible();
  await snapshot(page, version, "3-finished");
  await reachable(main.getByRole("link", { name: "See your recipes", exact: true }));
  await snapshot(page, version, "3-see-your-recipes");
  return finished;
}

/**
 * Moves the same backup in again: every recipe and photo is already here, so nothing comes in twice.
 * Returns that check, for the test to run again after a reload.
 */
export async function moveInAgain(version: string, { page }: Pick<JourneyArgs, "page">): Promise<() => Promise<void>> {
  const { recipes } = (await fixtures()).kitchens.small.counts;
  const main = page.getByRole("main");
  await main.getByRole("link", { name: "Move in another backup", exact: true }).click();
  await dropBackup(page, version);
  const nothingAdded = async () => {
    await expect(main.getByRole("heading", { level: 2, name: "Everything was already here", exact: true })).toBeVisible({ timeout: MOVE_IN_MS });
    await expect(main.getByText(`${recipes} already here, 0 changed.`, { exact: true })).toBeVisible();
    // Nothing moved, so the page shows no counts that would read as if recipes or photos did.
    await expect(main.locator("dt", { hasText: "Recipes moved in" })).toHaveCount(0);
    await expect(main.locator("dt", { hasText: "Photos" })).toHaveCount(0);
  };
  await nothingAdded();
  await snapshot(page, version, "5-moved-in-again");
  return nothingAdded;
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A link named exactly this, whatever its case: Kitchen names an organizer after the first spelling it meets. */
const named = (name: string) => new RegExp(`^${escaped(name.trim().replace(/\s+/g, " "))}$`, "i");

/**
 * Finds the version's sample recipe in the person's kitchen, once and under its own name, and opens
 * it to see its photo and steps, then its Organize page to see its tags, categories and tools, after
 * a reload. Each account moves in one kitchen, so a second copy ("Title (2)") would mean a recipe
 * came in twice.
 */
export async function inTheKitchen(version: string, { page, verifyAfterReload }: Pick<JourneyArgs, "page" | "verifyAfterReload">) {
  await fixtures();
  const { title, tags, categories, tools } = samples.get(version) as { title: string; tags: string[]; categories: string[]; tools: string[] };
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

  const recipePath = new URL(page.url()).pathname;
  await waitForHydration(page);
  await chooseMenuItem(page, main.getByRole("button", { name: "Recipe actions", exact: true }), "Organize");
  await expect(page).toHaveURL(pathUrl(`${recipePath}/organize`));
  await verifyAfterReload(async () => {
    for (const [label, names] of [["Tags", tags], ["Categories", categories], ["Tools", tools]] as const) {
      const region = main.getByRole("region", { name: `${label} on this recipe`, exact: true });
      for (const name of names) await expect(region.getByRole("link", { name: named(name) })).toBeVisible();
    }
  });
  await snapshot(page, version, "4-recipe-tags");
}
