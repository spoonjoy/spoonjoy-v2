// Moving a kitchen in, for the Move in journeys (move-in.mobile.journey.ts, move-in.desktop.journey.ts):
// drop a source version's small kitchen backup on /move-in, watch it move in, and check the finish
// screen against the move-in proof's manifest, with the kitchen's tags, categories and tools counted;
// move the same backup in again and see nothing added; find one of its recipes, photo, steps, tags
// and all, in the kitchen. The backups and the manifest are
// the published proof fixtures (scripts/move-in-proof, release move-in-proof-fixtures-v1), read from
// the public release and checked against the pinned manifest. Each version's kitchen has its own ids
// (checked below), and each journey moves into its own fresh scratch account.
import { open } from "node:fs/promises";
import { crc32 } from "node:zlib";
import type { Locator, Page, Request } from "@playwright/test";
import { test, expect, type ExpectConsoleError } from "./journey";
import { bytesSource } from "../../../app/domains/move-in/adapters/archive/zip";
import { openMealieBackup } from "../../../app/domains/move-in/adapters/sources/mealie-backup/backup";
import { chooseGroup, recipeDrafts } from "../../../app/domains/move-in/adapters/sources/mealie-backup/database";
import { planOrganizerAssignment } from "../../../app/domains/kitchen/model/organizer";
import { UPLOAD_FETCH_TIMEOUT_MS } from "./app-ready";
import { requiredLabel } from "./forms";
import { chooseMenuItem } from "./menu";
import { pathUrl, waitForHydration } from "./navigation";
import { proofFixtures } from "./move-in-fixtures";
import { UPLOAD_ATTEMPTS, UPLOAD_CONCURRENCY } from "../../../app/lib/move-in-upload";

// A move-in of a small kitchen polls every few seconds; give it room on a slow QA run.
const MOVE_IN_MS = 150_000;

interface Manifest {
  kitchens: { small: { counts: { recipes: number; recipesWithPhoto: number } } };
  sources: Array<{ version: string; fixtures: { small: { backup: string } } }>;
}

let manifest: Manifest | undefined;
const backups = new Map<string, Buffer>();
/** One recipe with a photo and tags from each version's kitchen, to find after it moves in, with its organizers' names. */
const samples = new Map<string, { title: string; tags: string[]; categories: string[]; tools: string[] }>();
/**
 * Each version's tags, categories and tools that are on at least one of its recipes, read from the backup's own link
 * tables rather than through the move-in's parser. Each proof kitchen names its organizers apart, so one id is one
 * organizer on the finish screen.
 */
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
    samples.set(source.version, { title: sample.title, tags: names(sample.tags), categories: names(sample.categories), tools: names(sample.tools) });
    const used = (links: string, column: string, table: string) => {
      const exists = new Set(backup.database.rows(table).map((row) => guid(row.id)));
      return new Set(backup.database.rows(links).map((row) => guid(row[column])).filter((id) => exists.has(id))).size;
    };
    organizerCounts.set(source.version, {
      tags: used("recipes_to_tags", "tag_id", "tags"),
      categories: used("recipes_to_categories", "category_id", "categories"),
      tools: used("recipes_to_tools", "tool_id", "tools"),
    });
  }
  if (groups.size !== read.sources.length) throw new Error("Two proof kitchens share a kitchen id, so they would move in as one");
  manifest = read;
  return read;
}

function detail(page: Page, term: string) {
  return page.getByRole("main").locator("dt", { hasText: term }).locator("xpath=following-sibling::dd[1]");
}

/** A part of a backup on its way to storage: the page sends a backup in parts, never through the form. */
const PART_URL = /\/move-in\/uploads\/[^/]+\/parts\/\d+$/;
const isPart = (request: Request) => request.method() === "PUT" && PART_URL.test(new URL(request.url()).pathname);

async function dropBackup(page: Page, version: string) {
  await page.getByLabel(requiredLabel("Backup zip"), { exact: true }).setInputFiles({
    name: `kitchen-${version}.zip`,
    mimeType: "application/zip",
    buffer: backups.get(version) as Buffer,
  });
  const part = page.waitForRequest(isPart);
  await page.getByRole("button", { name: "Move in", exact: true }).click();
  await part;
  // The page moves on once the Worker has read the whole upload, which Journeys gives as long as an upload takes.
  await expect(page).toHaveURL(/\/move-in\?job=movein_/, { timeout: UPLOAD_FETCH_TIMEOUT_MS });
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

/** A backup id, whichever way its version writes it. */
const guid = (id: unknown) => String(id).toLowerCase().replace(/-/g, "");

/** The organizers these names make in an empty kitchen, by name, once each: Kitchen's own matching. */
function names(raw: string[]): string[] {
  return planOrganizerAssignment([], raw).create.map((organizer) => organizer.name);
}

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
    // Each kind's token field holds a chip per organizer, named by its Remove button.
    for (const [segment, kindNames] of [["tags", tags], ["categories", categories], ["tools", tools]] as const) {
      const field = main.locator(`div:has(> input[name="organize"][value="${segment}"])`);
      for (const name of kindNames) await expect(field.getByRole("button", { name: `Remove ${name}`, exact: true })).toBeVisible();
    }
  });
  await snapshot(page, version, "4-recipe-tags");
}

const PART_BYTES = 10 * 1024 * 1024;
/** Padding parts in the big backup: with the kitchen, 21 parts of 10 MiB. */
const PADDING_PARTS = 20;

/**
 * Writes a backup of over 200 MB: the version's small kitchen with 20 padding files of 10 MiB in front of
 * it, stored as they are, which the move-in reads past. The kitchen's own entries are copied byte for byte,
 * so it moves in as the small kitchen does. Returns the file's path.
 */
async function bigBackup(version: string): Promise<string> {
  await fixtures();
  const path = test.info().outputPath(`kitchen-${version}-big.zip`);
  await padBackup(backups.get(version) as Buffer, path);
  return path;
}

/** Writes `small` to `path` with the padding in front of its entries. */
export async function padBackup(small: Buffer, path: string): Promise<void> {
  const end = small.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = small.readUInt16LE(end + 10);
  const directorySize = small.readUInt32LE(end + 12);
  const directoryOffset = small.readUInt32LE(end + 16);
  const padding = Buffer.alloc(PART_BYTES, 0x5a);
  const crc = crc32(padding);
  const file = await open(path, "w");
  const central: Buffer[] = [];
  let at = 0;
  for (let index = 0; index < PADDING_PARTS; index++) {
    const name = Buffer.from(`spoonjoy-journey-padding/${String(index).padStart(2, "0")}.bin`);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(PART_BYTES, 18);
    local.writeUInt32LE(PART_BYTES, 22);
    local.writeUInt16LE(name.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(10, 6);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(PART_BYTES, 20);
    record.writeUInt32LE(PART_BYTES, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(at, 42);
    central.push(record, name);
    await file.write(Buffer.concat([local, name]));
    await file.write(padding);
    at += local.length + name.length + PART_BYTES;
  }
  // The kitchen's entries, moved along by the padding in front of them.
  await file.write(small.subarray(0, directoryOffset));
  const directory = Buffer.from(small.subarray(directoryOffset, directoryOffset + directorySize));
  for (let offset = 0; offset < directory.length; ) {
    directory.writeUInt32LE(directory.readUInt32LE(offset + 42) + at, offset + 42);
    offset += 46 + directory.readUInt16LE(offset + 28) + directory.readUInt16LE(offset + 30) + directory.readUInt16LE(offset + 32);
  }
  central.push(directory);
  const directoryBytes = Buffer.concat(central);
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(count + PADDING_PARTS, 8);
  record.writeUInt16LE(count + PADDING_PARTS, 10);
  record.writeUInt32LE(directoryBytes.length, 12);
  record.writeUInt32LE(at + directoryOffset, 16);
  await file.write(directoryBytes);
  await file.write(record);
  await file.close();
}

/**
 * Sends a backup of over 200 MB whose connection drops partway, as on a phone: the parts after the first few
 * never arrive, the page says how far it got, and the cook reloads and chooses the same file again. The page
 * carries on from the parts that arrived, sending fewer than all of them, and the backup moves in. Returns
 * that last check, for the test to run again after a reload.
 */
export async function moveInAfterADrop(version: string, { page, expectConsoleError }: Pick<JourneyArgs, "page"> & { expectConsoleError: ExpectConsoleError }): Promise<() => Promise<void>> {
  test.setTimeout(Math.max(test.info().timeout, 4 * MOVE_IN_MS));
  const path = await bigBackup(version);
  const { recipes } = (await fixtures()).kitchens.small.counts;
  const total = PADDING_PARTS + 1;
  const main = page.getByRole("main");
  // The dropped parts, and any cut off by the reload, are logged as failed loads: each try of each part in flight, up
  // to every try of as many parts as go at once, plus those cut off. Each allowance covers one log line.
  for (let copy = 0; copy < UPLOAD_CONCURRENCY * (UPLOAD_ATTEMPTS + 1); copy++) {
    expectConsoleError(/^Failed to load resource: net::/, { url: PART_URL, optional: true });
  }

  const sent: number[] = [];
  page.on("requestfinished", async (request) => {
    if (isPart(request) && (await request.response())?.ok()) sent.push(Number(request.url().split("/").at(-1)));
  });
  let through = 0;
  await page.route(PART_URL, async (route) => {
    if (route.request().method() === "PUT" && through >= 5) return route.abort("connectionreset");
    through += 1;
    return route.continue();
  });
  await page.goto("/move-in");
  await waitForHydration(page);
  const field = page.getByLabel(requiredLabel("Backup zip"), { exact: true });
  await field.setInputFiles(path);
  await page.getByRole("button", { name: "Move in", exact: true }).click();
  await expect(main.getByText(/ of 2\d\d MB sent$/)).toBeVisible();
  // Each part is tried five times over about 15 s before the page gives up.
  await expect(main.getByText(/^The connection dropped after \d+ MB of 2\d\d MB was sent\. Press Move in again with the same file to carry on from there\.$/)).toBeVisible({ timeout: 90_000 });
  await snapshot(page, version, "6-dropped");
  const before = sent.length;
  expect(before, "parts that arrived before the drop").toBeGreaterThanOrEqual(5);
  expect(before).toBeLessThan(total);

  await page.unroute(PART_URL);
  await page.reload();
  await waitForHydration(page);
  await field.setInputFiles(path);
  await page.getByRole("button", { name: "Move in", exact: true }).click();
  await expect(page).toHaveURL(/\/move-in\?job=movein_/, { timeout: MOVE_IN_MS });
  const again = sent.slice(before);
  // Only the parts that hadn't arrived went again, and together they make the whole backup.
  expect(again.length, "parts sent after the reload").toBeLessThan(total);
  expect(new Set(sent)).toEqual(new Set(Array.from({ length: total }, (_, index) => index + 1)));
  // The account's v1 kitchen moved in earlier in the run, unless this journey ran alone.
  const movedIn = async () => {
    const outcome = main.getByRole("heading", { level: 2, name: new RegExp(`^(${recipes} recipes moved in|Everything was already here)$`) });
    await expect(outcome).toBeVisible({ timeout: MOVE_IN_MS });
    await expect(main.getByText(/stayed in the backup/)).toHaveCount(0);
  };
  await movedIn();
  await snapshot(page, version, "7-moved-in-after-a-drop");
  return movedIn;
}

/**
 * Starts sending a backup of over 200 MB, presses Stop upload once a few parts are in, and checks the upload was
 * aborted on the server and the page went back to the empty form. Choosing the same file after a reload then starts
 * over from part 1 rather than carrying on, and that upload is stopped too, so nothing is left behind.
 */
export async function stopAndStartAgain(version: string, { page, expectConsoleError }: Pick<JourneyArgs, "page"> & { expectConsoleError: ExpectConsoleError }) {
  test.setTimeout(Math.max(test.info().timeout, 2 * MOVE_IN_MS));
  const path = await bigBackup(version);
  const main = page.getByRole("main");
  // Parts cut off by the stop may be logged as failed loads.
  expectConsoleError(/^Failed to load resource: net::/, { url: PART_URL, optional: true });
  const isBegin = (request: Request) => request.method() === "POST" && new URL(request.url()).pathname === "/move-in/uploads";
  const isStop = (request: Request) => request.method() === "DELETE" && /^\/move-in\/uploads\/[^/]+$/.test(new URL(request.url()).pathname);
  const arrived: number[] = [];
  page.on("requestfinished", async (request) => {
    if (isPart(request) && (await request.response())?.ok()) arrived.push(Number(request.url().split("/").at(-1)));
  });

  const stopNow = async () => {
    const stopped = page.waitForResponse((response) => isStop(response.request()));
    await main.getByRole("button", { name: "Stop upload", exact: true }).click();
    expect((await stopped).ok(), "the upload was aborted on the server").toBe(true);
    await expect(main.getByText("Upload stopped", { exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: "Stop upload", exact: true })).toHaveCount(0);
    await expect(main.getByRole("button", { name: "Move in", exact: true })).toBeEnabled();
  };

  await page.goto("/move-in");
  await waitForHydration(page);
  const field = page.getByLabel(requiredLabel("Backup zip"), { exact: true });
  await field.setInputFiles(path);
  const begun = page.waitForResponse((response) => isBegin(response.request()));
  await page.getByRole("button", { name: "Move in", exact: true }).click();
  const uploadId = ((await (await begun).json()) as { uploadId: string }).uploadId;
  await expect.poll(() => arrived.length, { timeout: MOVE_IN_MS }).toBeGreaterThanOrEqual(2);
  await stopNow();
  await snapshot(page, version, "8-stopped");

  await page.reload();
  await waitForHydration(page);
  await field.setInputFiles(path);
  const again = page.waitForResponse((response) => isBegin(response.request()));
  const firstPart = page.waitForRequest(isPart);
  await page.getByRole("button", { name: "Move in", exact: true }).click();
  const answer = await again;
  // Nothing to carry on from: the page forgot the upload, and the server aborted it.
  expect(JSON.parse(answer.request().postData() ?? "{}").resume).toBeNull();
  const plan = (await answer.json()) as { uploadId: string; done: number[] };
  expect(plan.uploadId).not.toBe(uploadId);
  expect(plan.done).toEqual([]);
  expect(new URL((await firstPart).url()).pathname).toMatch(/\/parts\/1$/);
  await stopNow();
}
