// Times a large kitchen's move-in for move-in.desktop.journey.ts: drops the version's 500-recipe backup from
// the move-in proof's fixtures on /move-in, waits for the finished screen, checks it against the manifest, and writes
// the time it took to the run's summary ($GITHUB_STEP_SUMMARY) and the report.
import { appendFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./journey";
import { proofFixtures } from "./move-in-fixtures";

// A 500-recipe kitchen on a busy QA Worker; the time it actually takes is what the journey reports. It wasn't in after
// 18 minutes on its first run (Journeys run 45390496178), so this waits 45. The timed runs give part 2 90 minutes:
// about 7 before this starts, 47 for it, and about 15 after for the cleanup to delete its photos.
const LARGE_MOVE_IN_MS = 45 * 60_000;
const BACKUP_MAX_BYTES = 50 * 1024 * 1024;

interface LargeKitchen {
  kitchens: { large: { counts: { recipes: number; recipesWithPhoto: number } } };
  sources: Array<{ version: string; fixtures: { large: { backup: string } } }>;
}

function detail(page: Page, term: string) {
  return page.getByRole("main").locator("dt", { hasText: term }).locator("xpath=following-sibling::dd[1]");
}

function minutesAndSeconds(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/**
 * Moves the version's large kitchen in, checks every recipe and photo arrived, and reports the time it took. Answers
 * the check of the finished screen, for the journey to run again after a reload.
 */
export async function timeLargeMoveIn(version: string, { page }: { page: Page }): Promise<() => Promise<void>> {
  test.setTimeout(LARGE_MOVE_IN_MS + 2 * 60_000);
  const { manifest, bundle } = await proofFixtures();
  const { kitchens, sources } = manifest as unknown as LargeKitchen;
  const source = sources.find((candidate) => candidate.version === version);
  if (!source) throw new Error(`The proof fixtures have no ${version} kitchen`);
  const entry = bundle.get(source.fixtures.large.backup);
  if (!entry) throw new Error(`The proof fixtures have no ${source.fixtures.large.backup}`);
  const backup = Buffer.from(await bundle.read(entry, { maxBytes: BACKUP_MAX_BYTES }));
  const { recipes, recipesWithPhoto } = kitchens.large.counts;
  const main = page.getByRole("main");

  await page.goto("/move-in");
  await expect(main.getByRole("heading", { level: 1, name: "Bring your kitchen with you." })).toBeVisible();
  const from = main.getByRole("radio", { name: /^From a backup/ });
  // The page asks for a server or a backup once moving in from a server lands; until then it only takes a backup.
  if (await from.count()) await from.check();
  await page.getByLabel("Backup zip", { exact: true }).setInputFiles({ name: `kitchen-${version}-large.zip`, mimeType: "application/zip", buffer: backup });
  const started = Date.now();
  await main.getByRole("button", { name: "Move in", exact: true }).click();
  await expect(page).toHaveURL(/\/move-in\?job=movein_/, { timeout: 120_000 });
  const report = (line: string) => {
    test.info().annotations.push({ type: "move-in time", description: line });
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Move in, timed\n\n${line}\n\n`);
    console.log(line);
  };
  try {
    await expect(main.getByRole("heading", { level: 2, name: `${recipes} recipes moved in`, exact: true })).toBeVisible({ timeout: LARGE_MOVE_IN_MS });
  } catch (error) {
    // Too slow is a result too: say how far it got, so the run shows the pace even when it fails.
    const sofar = await main.getByRole("status").innerText({ timeout: 5000 }).catch(() => "no progress shown");
    report(`Move in, ${recipes} recipes (${version}): not finished ${minutesAndSeconds(Date.now() - started)} after pressing Move in. The page said: ${sofar.replace(/\s+/g, " ").trim()}`);
    throw error;
  }
  const took = Date.now() - started;
  const finished = async () => {
    await expect(main.getByRole("heading", { level: 2, name: `${recipes} recipes moved in`, exact: true })).toBeVisible();
    await expect(detail(page, "Recipes moved in")).toHaveText(String(recipes));
    await expect(detail(page, "Photos")).toHaveText(`${recipesWithPhoto} of ${recipesWithPhoto}`);
  };
  await finished();

  // The page asks for progress every few seconds, so this can run up to one ask past the move-in's own end.
  report(`Move in, ${recipes} recipes and ${recipesWithPhoto} photos (${version}): ${minutesAndSeconds(took)} from pressing Move in to the finished screen, which shows within one progress check of the end.`);
  await test.info().attach(`move-in-${version}-large-finished`, { body: await page.screenshot({ fullPage: true, animations: "disabled" }), contentType: "image/png" });
  return finished;
}
