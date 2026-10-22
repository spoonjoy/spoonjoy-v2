import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import axe from "axe-core";
import { BASELINE_PATH, checkCensusState, controlIdentity, EXPECTED_FILE, expectedFromJourneys, stringifyCensus, toMultiset, workerFileName } from "./census.mjs";
import { animationsSettled, censusExclusions, collectInPage, interactiveSelector } from "./census-collect.mjs";

/* global URL */

// The census's Playwright side. An app lists its journeys (every page it renders, as the visitor
// who sees it, and every state a person can open on it: dialogs, menus, sheets, popovers,
// disclosures) and calls `censusTests` from a spec of its own. Each state loads the journey's path
// fresh, runs the state's action (which only opens things, never submits), waits for animations,
// records the exact multiset of visible controls in this worker's census file, and fails unless it
// equals the baseline (and, for an enrolled journey, every control is an Ouro control).
//
// A journey enrolled in the census must be 100% Ouro: every control it shows carries a
// data-ouro-control marker naming an installed component. An unenrolled journey is measured, and
// its unmarked count may only fall (census-update.mjs refuses a rise).

/**
 * @typedef {import("@playwright/test").Page} Page
 * @typedef {{ id: string, action?: (page: Page) => Promise<void> }} CensusState
 * @typedef {{
 *   id: string,
 *   enrolled: boolean,
 *   path: string,
 *   status?: number,
 *   storageState?: string | { cookies: unknown[], origins: unknown[] },
 *   states: CensusState[],
 * }} Journey
 * @typedef {Array<{ identity: string, count: number }>} Multiset
 */

const SETTLE_ATTEMPTS = 20;
const SETTLE_INTERVAL_MS = 250;

/**
 * The visible controls' identities, once no finite animation runs.
 * @param {Page} page
 * @returns {Promise<string[]>}
 * @claim "once no finite animation runs" scripts/kits/census-page.test.mjs verify:testExists(scripts/kits/census-page.test.mjs::collectCensus > loads axe-core, waits for animations, and returns the visible controls once two readings agree)
 */
async function identitiesOnPage(page) {
  await page.waitForFunction(animationsSettled);
  const controls = await page.evaluate(collectInPage, { selector: interactiveSelector, exclusions: censusExclusions });
  return controls.filter((control) => control.visible).map((control) => controlIdentity(control));
}

/**
 * The state's multiset of visible control identities, once two readings a moment apart agree (late
 * data and lazy sections can still add controls after hydration and animations).
 * @param {Page} page
 * @param {{ attempts?: number, intervalMs?: number }} [options]
 * @returns {Promise<Multiset>}
 * @claim "once two readings a moment apart agree" scripts/kits/census-page.test.mjs verify:testExists(scripts/kits/census-page.test.mjs::collectCensus > loads axe-core, waits for animations, and returns the visible controls once two readings agree)
 * @claim "once two readings a moment apart agree" scripts/kits/census-page.test.mjs verify:testExists(scripts/kits/census-page.test.mjs::collectCensus > reads 20 times, 250 ms apart, by default)
 */
export async function collectCensus(page, { attempts = SETTLE_ATTEMPTS, intervalMs = SETTLE_INTERVAL_MS } = {}) {
  await page.evaluate(axe.source);
  let previous = JSON.stringify(toMultiset(await identitiesOnPage(page)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await page.waitForTimeout(intervalMs);
    const current = JSON.stringify(toMultiset(await identitiesOnPage(page)));
    if (current === previous) return JSON.parse(current);
    previous = current;
  }
  throw new Error(`Ouro census: the page's controls never settled (${attempts} readings ${intervalMs} ms apart all differed).`);
}

/**
 * The installed Ouro components' names, the only valid markers: the stem of each component file
 * under `componentsDir` (`components/ouro/select/native-select.tsx` is `native-select`).
 * @param {string} componentsDir
 * @param {(directory: string) => string[]} [readdir]
 * @returns {string[]}
 * @claim "the stem of each component file" scripts/kits/census-page.test.mjs verify:testExists(scripts/kits/census-page.test.mjs::installedItems > names each installed component file's stem, the values its markers carry)
 */
export function installedItems(componentsDir, readdir = (directory) => readdirSync(directory)) {
  const stems = new Set();
  for (const folder of readdir(componentsDir)) {
    if (folder.includes(".")) continue;
    for (const file of readdir(path.join(componentsDir, folder))) {
      const match = /^([a-z][a-z0-9-]*)\.tsx$/.exec(file);
      if (match && !/-(parts|styles)$/.test(match[1])) stems.add(match[1]);
    }
  }
  return [...stems].sort();
}

/**
 * Writes the states this run must record (every state of every journey, on every project) to
 * census-expected.json in `directory`, so the merge fails when any is missing. Every worker writes
 * the same content; each writes a file of its own and renames it into place, so a reader never
 * sees half of one.
 * @param {{ journeys: readonly Journey[], projects: readonly string[], worker: number, directory: string }} options
 * @returns {string}
 * @claim "Writes the states this run must record" scripts/kits/census-page.test.mjs verify:testExists(scripts/kits/census-page.test.mjs::recording > writes the expected set, projects and states, in one rename)
 * @claim "Every worker writes the same content" scripts/kits/census-page.test.mjs verify:testExists(scripts/kits/census-page.test.mjs::recording > writes the expected set, projects and states, in one rename)
 */
export function recordExpectedCensus({ journeys, projects, worker, directory }) {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, EXPECTED_FILE);
  const partial = `${file}.${process.pid}.${worker}.partial`;
  writeFileSync(partial, stringifyCensus(expectedFromJourneys(journeys, projects)));
  renameSync(partial, file);
  return file;
}

/** @type {Record<string, Record<string, Record<string, Multiset>>>} */
const recorded = {};

/**
 * Adds one state's multiset to this worker's census file (census-actual.<project>.<worker>.json in
 * `directory`) and returns the file's path. A worker restarted after a failure gets a new index,
 * so its file is new.
 * @param {{ directory: string, project: string, worker: number, journeyId: string, stateId: string, multiset: Multiset }} options
 * @returns {string}
 */
export function recordCensus({ directory, project, worker, journeyId, stateId, multiset }) {
  ((recorded[project] ??= {})[journeyId] ??= {})[stateId] = multiset;
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, workerFileName(project, worker));
  writeFileSync(file, `${JSON.stringify({ [project]: recorded[project] }, null, 2)}\n`);
  return file;
}

/**
 * Throws with every problem the census finds in one state: no baseline, any difference, or (when
 * the journey is enrolled) any unmarked control or marker naming no installed component.
 * @param {{ baseline: Record<string, unknown>, baselinePath: string, project: string, journey: Journey, stateId: string, actual: Multiset, actualPath: string, knownItems: readonly string[] }} options
 * @claim "Throws with every problem the census finds" scripts/kits/census-page.test.mjs verify:testExists(scripts/kits/census-page.test.mjs::recording > throws every problem with a state, and nothing for a match)
 */
export function expectCensusMatches({ baseline, baselinePath, project, journey, stateId, actual, actualPath, knownItems }) {
  const problems = checkCensusState({ baseline, baselinePath, project, journeyId: journey.id, stateId, actual, enrolled: journey.enrolled, knownItems, actualPath });
  if (problems.length > 0) throw new Error(problems.join("\n\n"));
}

/**
 * Registers the census: one test per state of every journey, each tagged `@ouro-census`, on every
 * Playwright project the spec runs in (list them all in `projects`; the merge fails when one
 * recorded nothing). Each test loads the journey's `path` (with its `storageState`), fails unless
 * the document answers `status` (200) and the page stays at `path`, runs `prepare` (wait for
 * hydration, say), then the state's action, and checks the visible controls against the baseline.
 *
 * @param {{
 *   test: any,
 *   journeys: readonly Journey[],
 *   projects: readonly string[],
 *   componentsDir: string,
 *   baselinePath?: string,
 *   resultsDir?: string,
 *   prepare?: (page: Page) => Promise<void>,
 * }} options
 * @claim "Registers the census" scripts/kits/census-page.test.mjs verify:testExists(scripts/kits/census-page.test.mjs::censusTests > registers one tagged test per state, each journey with its session, and the expected set before them)
 * @claim "Each test loads the journey's" scripts/kits/census-page.test.mjs verify:testExists(scripts/kits/census-page.test.mjs::censusTests > fails a state whose page answers another status, redirects, or differs from the baseline)
 */
export function censusTests({ test, journeys, projects, componentsDir, baselinePath = BASELINE_PATH, resultsDir = process.env["OURO_CENSUS_DIR"] ?? "ouro-census", prepare }) {
  const directory = path.resolve(resultsDir);
  /** @type {Record<string, unknown> | undefined} */
  let baseline;
  test.beforeAll((/** @type {unknown} */ _fixtures, /** @type {{ workerIndex: number }} */ testInfo) => {
    recordExpectedCensus({ journeys, projects, worker: testInfo.workerIndex, directory });
  });
  for (const journey of journeys) {
    test.describe(`Ouro census ${journey.id}`, () => {
      if (journey.storageState !== undefined) test.use({ storageState: journey.storageState });
      for (const state of journey.states) {
        test(`${journey.id} / ${state.id}`, { tag: "@ouro-census" }, async (/** @type {{ page: Page }} */ { page }, /** @type {{ project: { name: string }, workerIndex: number }} */ testInfo) => {
          const status = journey.status ?? 200;
          const response = await page.goto(journey.path);
          if (response?.status() !== status) throw new Error(`Ouro census: ${journey.path} answered ${response?.status()}, not ${status}.`);
          await prepare?.(page);
          // A redirect (a signed-out visit to a signed-in page, say) would measure some other page.
          const landed = new URL(page.url());
          if (`${landed.pathname}${landed.search}` !== journey.path) {
            throw new Error(`Ouro census: ${journey.path} redirected to ${landed.pathname}${landed.search}; a journey's path is where its page is.`);
          }
          await state.action?.(page);
          const actual = await collectCensus(page);
          const project = testInfo.project.name;
          const actualPath = recordCensus({ directory, project, worker: testInfo.workerIndex, journeyId: journey.id, stateId: state.id, multiset: actual });
          // Before the first update there is no baseline, and every state says so.
          baseline ??= existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : {};
          expectCensusMatches({ baseline: /** @type {Record<string, unknown>} */ (baseline), baselinePath, project, journey, stateId: state.id, actual, actualPath, knownItems: installedItems(componentsDir) });
        });
      }
    });
  }
}
