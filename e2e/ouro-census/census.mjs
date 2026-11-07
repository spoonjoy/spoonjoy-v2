/** Where the baseline lives, beside the census kit. */
export const BASELINE_PATH = "e2e/ouro-census/census.baseline.json";
/** The merged census of one run, which CI uploads as the `ouro-census-actual` artifact. */
export const ACTUAL_FILE = "census-actual.json";
/**
 * The expected set the census spec writes beside its worker files: the Playwright projects every
 * run must record under `$projects`, and `{ [journeyId]: [stateId, ...] }`.
 * @claim "The expected set the census spec writes" scripts/kits/census-update.test.mjs verify:testExists(scripts/kits/census-update.test.mjs::census files > validates the expected set and builds it from the census list)
 */
export const EXPECTED_FILE = "census-expected.json";
export const ARTIFACT_NAME = "ouro-census-actual";
/** What the update is run as, in the messages that ask for it. Apps usually alias it as a package script. */
export const UPDATE_COMMAND = "node e2e/ouro-census/census-update.mjs <run-id>";
export const UNMARKED = "-";

// The Ouro census's pure logic, shared by the census spec (census-page.mjs), the merge
// (census-merge.mjs), the baseline update (census-update.mjs) and the comparison of two runs
// (census-compare.mjs). It imports nothing, so it runs in Node and in Playwright alike.
//
// A control's identity is one line: its role, its normalized accessible name (JSON-quoted), its
// Ouro marker and part (`data-ouro-control` / `data-ouro-part`, "-" when absent) and its context
// (the nearest ancestor landmark, dialog or named group/region, else the nearest data-testid,
// else "-"):
//
//   button "Save" [button/root] in main
//   option "Weeknight" [select/item] in dialog "Add to list"
//   link "Notes" [-/-] in testid "note-actions"
//
// Never a DOM position. A state's census is the exact multiset of its visible controls'
// identities: `[{ identity, count }]`, sorted by identity. A census file (a worker's actual, the
// merged actual, or the baseline) is `{ [project]: { [journeyId]: { [stateId]: Multiset } } }`;
// keys starting with "$" are metadata (the merged actual's `$expected`, the baseline's
// `$allowedRegressions` and `$removed`), never projects.

const WORKER_FILE_PATTERN = /^census-actual\.(.+)\.(\d+)\.json$/;
const IDENTITY_PATTERN = /^(\S+) ("(?:[^"\\]|\\.)*") \[([^\s/\]]+)\/([^\s/\]]+)\] in (.+)$/;

export const RELATIVE_TIME = "<relative time>";
export const CALENDAR_DATE = "<date>";

const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const UNIT = "(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|mins?|hrs?|mos?|yrs?)";
// A relative time ("2 minutes ago", "1 hr ago", "less than a minute ago", "just now", "yesterday")
// and a calendar date ("Jun 1, 2026", "Jun 2026") depend on when the run happened, not on the page.
const RELATIVE_TIME_PATTERN = new RegExp(`\\b(?:(?:less than |about |over |almost )?(?:\\d+|an?|one) ${UNIT} ago|just now|yesterday)\\b`, "gi");
const CALENDAR_DATE_PATTERN = new RegExp(`\\b${MONTH} (?:\\d{1,2}, )?\\d{4}\\b`, "g");

/**
 * Collapses every run of whitespace to one space and trims. Case and punctuation are kept, but a
 * relative time or a calendar date becomes a placeholder, so a name never depends on the run's date.
 * @param {unknown} text
 * @returns {string}
 * @claim "Collapses every run of whitespace" scripts/kits/census-update.test.mjs verify:testExists(scripts/kits/census-update.test.mjs::identity > normalizes a name's whitespace and keeps its case and punctuation)
 * @claim "so a name never depends on the run's date" scripts/kits/census-update.test.mjs verify:testExists(scripts/kits/census-update.test.mjs::identity > replaces relative times and calendar dates, which depend on the run, with placeholders)
 */
export function normalizeName(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(RELATIVE_TIME_PATTERN, RELATIVE_TIME)
    .replace(CALENDAR_DATE_PATTERN, CALENDAR_DATE);
}

/**
 * A marker value as one token: "-" when absent or blank; whitespace, "/" and brackets become "_".
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function normalizeMarker(value) {
  const token = normalizeName(value).replace(/[\s/[\]]/g, "_");
  return token === "" ? UNMARKED : token;
}

/**
 * The context part of an identity: the nearest landmark/dialog/named group or region (`main`,
 * `dialog "Save to cookbook"`), else the nearest ancestor data-testid (`testid "recipe-owner-tools"`),
 * else "-".
 * @param {{ landmark?: { role: string, name?: string | null } | null, testId?: string | null }} context
 * @returns {string}
 */
export function identityContext({ landmark, testId }) {
  if (landmark) {
    const name = normalizeName(landmark.name);
    return name ? `${landmark.role} ${JSON.stringify(name)}` : landmark.role;
  }
  const id = normalizeName(testId);
  return id ? `testid ${JSON.stringify(id)}` : UNMARKED;
}

/**
 * @typedef {{
 *   role: string,
 *   name?: string | null,
 *   control?: string | null,
 *   part?: string | null,
 *   landmark?: { role: string, name?: string | null } | null,
 *   testId?: string | null,
 * }} RawControl
 */

/**
 * @param {RawControl} control
 * @returns {string}
 */
export function controlIdentity(control) {
  const role = normalizeName(control.role).replace(/\s+/g, "_") || "generic";
  const name = JSON.stringify(normalizeName(control.name));
  return `${role} ${name} [${normalizeMarker(control.control)}/${normalizeMarker(control.part)}] in ${identityContext(control)}`;
}

/**
 * @param {string} identity
 * @returns {{ role: string, name: string, control: string, part: string, context: string }}
 */
export function parseIdentity(identity) {
  const match = IDENTITY_PATTERN.exec(identity);
  if (!match) throw new Error(`Not a census identity: ${JSON.stringify(identity)}`);
  return { role: match[1], name: JSON.parse(match[2]), control: match[3], part: match[4], context: match[5] };
}

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * @typedef {Array<{ identity: string, count: number }>} Multiset
 */

/**
 * @param {string[]} identities
 * @returns {Multiset}
 */
export function toMultiset(identities) {
  const counts = new Map();
  for (const identity of identities) counts.set(identity, (counts.get(identity) ?? 0) + 1);
  return [...counts.keys()].sort(compareStrings).map((identity) => ({ identity, count: counts.get(identity) }));
}

function countsOf(multiset) {
  return new Map(multiset.map(({ identity, count }) => [identity, count]));
}

function withoutMarker(identity) {
  const { role, name, context } = parseIdentity(identity);
  return `${role} ${JSON.stringify(name)} in ${context}`;
}

/**
 * The difference between a baseline multiset and an actual one. An identity that lost one marker
 * and gained another (same role, name and context) is a re-marked pair rather than a removal and an
 * addition.
 * @param {Multiset} expected
 * @param {Multiset} actual
 */
export function diffMultisets(expected, actual) {
  const before = countsOf(expected);
  const after = countsOf(actual);
  const identities = [...new Set([...before.keys(), ...after.keys()])].sort(compareStrings);
  let added = [];
  let removed = [];
  const recounted = [];
  for (const identity of identities) {
    const was = before.get(identity) ?? 0;
    const now = after.get(identity) ?? 0;
    if (was === 0) added.push({ identity, count: now });
    else if (now === 0) removed.push({ identity, count: was });
    else if (was !== now) recounted.push({ identity, from: was, to: now });
  }
  const remarked = [];
  for (const gone of removed) {
    const key = withoutMarker(gone.identity);
    const replacement = added.find((candidate) => candidate.count === gone.count && withoutMarker(candidate.identity) === key);
    if (!replacement) continue;
    remarked.push({ from: gone.identity, to: replacement.identity, count: gone.count });
    added = added.filter((candidate) => candidate !== replacement);
    gone.count = 0;
  }
  removed = removed.filter((entry) => entry.count > 0);
  return { added, removed, recounted, remarked };
}

/**
 * @param {ReturnType<typeof diffMultisets>} diff
 * @returns {string[]}
 */
export function formatDiff({ added, removed, recounted, remarked }) {
  return [
    ...added.map(({ identity, count }) => `  added      ${identity} ×${count}`),
    ...removed.map(({ identity, count }) => `  removed    ${identity} ×${count}`),
    ...recounted.map(({ identity, from, to }) => `  count      ${identity} ×${from} → ×${to}`),
    ...remarked.map(({ from, to, count }) => `  re-marked  ${from} → ${to} ×${count}`),
  ];
}

/**
 * Everything wrong with one recorded state: no baseline for it, any difference from the baseline,
 * and, for an enrolled journey, every unmarked identity or marker naming an item the app has not installed.
 * @param {{
 *   baseline: Record<string, unknown>,
 *   project: string,
 *   journeyId: string,
 *   stateId: string,
 *   actual: Multiset,
 *   enrolled: boolean,
 *   knownItems: Iterable<string>,
 *   actualPath: string,
 *   baselinePath?: string,
 * }} options
 * @returns {string[]}
 * @claim "Everything wrong with one recorded state" scripts/kits/census-update.test.mjs verify:testExists(scripts/kits/census-update.test.mjs::checkCensusState > fails an enrolled journey on any unmarked control or unknown item, even when the baseline matches)
 * @claim "Everything wrong with one recorded state" scripts/kits/census-update.test.mjs verify:testExists(scripts/kits/census-update.test.mjs::checkCensusState > fails with the update command and the actual's path when the baseline lacks the project, journey or state)
 */
export function checkCensusState({ baseline, project, journeyId, stateId, actual, enrolled, knownItems, actualPath, baselinePath = BASELINE_PATH }) {
  const label = `${project} / ${journeyId} / ${stateId}`;
  const update = UPDATE_COMMAND;
  const problems = [];
  const expected = /** @type {any} */ (baseline)?.[project]?.[journeyId]?.[stateId];
  if (!Array.isArray(expected)) {
    problems.push(
      `Ouro census: no baseline for ${label} in ${baselinePath}: run ${update} once this run's artifact is uploaded. ` +
        `This run's actual multiset is in ${actualPath} (upload the run's merged census, census-merge.mjs, as its ${ARTIFACT_NAME} artifact).`,
    );
  } else {
    const lines = formatDiff(diffMultisets(expected, actual));
    if (lines.length > 0) {
      problems.push(
        [`Ouro census: ${label} differs from ${baselinePath}:`, ...lines, `If the change is intended, run ${update} and commit the baseline. Actual multiset: ${actualPath}.`].join("\n"),
      );
    }
  }
  if (enrolled) {
    const items = new Set(knownItems);
    const unmarked = actual.filter(({ identity }) => parseIdentity(identity).control === UNMARKED);
    const unknown = actual.filter(({ identity }) => {
      const { control } = parseIdentity(identity);
      return control !== UNMARKED && !items.has(control);
    });
    if (unmarked.length > 0) {
      problems.push([`Ouro census: ${journeyId} is enrolled, so every control must be an Ouro control; unmarked in ${label}:`, ...unmarked.map(({ identity, count }) => `  ${identity} ×${count}`)].join("\n"));
    }
    if (unknown.length > 0) {
      problems.push([`Ouro census: ${label} has markers naming no installed Ouro item:`, ...unknown.map(({ identity, count }) => `  ${identity} ×${count}`)].join("\n"));
    }
  }
  return problems;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Throws, naming every problem, unless `data` is a census file.
 * @param {unknown} data
 * @param {string} label
 * @returns {Record<string, Record<string, Record<string, Multiset>>>}
 * @claim "is a census file" scripts/kits/census-update.test.mjs verify:testExists(scripts/kits/census-update.test.mjs::census files > names every shape problem)
 */
export function validateCensus(data, label) {
  const problems = [];
  if (!isPlainObject(data)) throw new Error(`${label}: a census file is a JSON object of projects.`);
  for (const [project, journeys] of Object.entries(data)) {
    if (project.startsWith("$")) continue;
    if (!isPlainObject(journeys)) {
      problems.push(`${project}: expected an object of journeys`);
      continue;
    }
    for (const [journeyId, states] of Object.entries(journeys)) {
      if (!isPlainObject(states)) {
        problems.push(`${project} / ${journeyId}: expected an object of states`);
        continue;
      }
      for (const [stateId, multiset] of Object.entries(states)) {
        const where = `${project} / ${journeyId} / ${stateId}`;
        if (!Array.isArray(multiset)) {
          problems.push(`${where}: expected an array of { identity, count }`);
          continue;
        }
        const seen = new Set();
        for (const entry of multiset) {
          if (!isPlainObject(entry) || typeof entry.identity !== "string" || !Number.isInteger(entry.count) || entry.count < 1) {
            problems.push(`${where}: ${JSON.stringify(entry)} is not { identity: string, count: positive integer }`);
            continue;
          }
          if (!IDENTITY_PATTERN.test(entry.identity)) problems.push(`${where}: ${JSON.stringify(entry.identity)} is not a census identity`);
          if (seen.has(entry.identity)) problems.push(`${where}: ${entry.identity} is listed twice`);
          seen.add(entry.identity);
        }
      }
    }
  }
  if (problems.length > 0) throw new Error([`${label} is not a valid census file:`, ...problems.map((problem) => `  ${problem}`)].join("\n"));
  return /** @type {any} */ (data);
}

/**
 * The census with every key and multiset in a stable order, metadata ("$" keys) dropped.
 * @param {Record<string, any>} census
 * @claim "The census with every key and multiset" scripts/kits/census-update.test.mjs verify:testExists(scripts/kits/census-update.test.mjs::census files > sorts keys and multisets and drops metadata)
 */
export function sortCensus(census) {
  const sorted = {};
  for (const project of Object.keys(census).filter((key) => !key.startsWith("$")).sort(compareStrings)) {
    sorted[project] = {};
    for (const journeyId of Object.keys(census[project]).sort(compareStrings)) {
      sorted[project][journeyId] = {};
      for (const stateId of Object.keys(census[project][journeyId]).sort(compareStrings)) {
        sorted[project][journeyId][stateId] = [...census[project][journeyId][stateId]]
          .map(({ identity, count }) => ({ identity, count }))
          .sort((a, b) => compareStrings(a.identity, b.identity));
      }
    }
  }
  return sorted;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function stringifyCensus(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Throws unless the census records every expected project, each with at least one journey.
 * @param {Record<string, unknown>} census
 * @param {readonly string[]} projects
 * @param {string} label
 * @claim "Throws unless the census records every expected project" scripts/kits/census-update.test.mjs verify:testExists(scripts/kits/census-update.test.mjs::census files > requires every project)
 */
export function requireProjects(census, projects, label) {
  const missing = projects.filter((project) => !isPlainObject(census[project]));
  if (missing.length > 0) {
    throw new Error(`${label} is missing project(s) ${missing.join(", ")}: every census run records ${projects.join(" and ")}.`);
  }
  const empty = projects.filter((project) => Object.keys(/** @type {object} */ (census[project])).length === 0);
  if (empty.length > 0) {
    throw new Error(`${label} records nothing for project(s) ${empty.join(", ")}: every census run records every state of every journey.`);
  }
}

/**
 * @typedef {Record<string, string[]> & { $projects: string[] }} Expected
 */

/**
 * Throws, naming every problem, unless `data` is the census's expected set: the projects every
 * run records under `$projects` (a non-empty list, none twice) and `{ [journeyId]: [stateId, ...] }`,
 * at least one journey, every journey with at least one state, no state listed twice.
 * @param {unknown} data
 * @param {string} label
 * @returns {Expected}
 * @claim "is the census's expected set" scripts/kits/census-update.test.mjs verify:testExists(scripts/kits/census-update.test.mjs::census files > validates the expected set and builds it from the census list)
 */
export function validateExpected(data, label) {
  if (!isPlainObject(data) || Object.keys(data).filter((key) => !key.startsWith("$")).length === 0) {
    throw new Error(`${label}: the expected set is a non-empty JSON object of journeys, each listing its states.`);
  }
  const problems = [];
  const projects = data.$projects;
  if (!Array.isArray(projects) || projects.length === 0 || !projects.every((project) => typeof project === "string" && project !== "" && !project.startsWith("$"))) {
    problems.push("$projects: expected a non-empty array of Playwright project names");
  } else if (new Set(projects).size !== projects.length) {
    problems.push("$projects: a project is listed twice");
  }
  for (const [journeyId, states] of Object.entries(data)) {
    if (journeyId.startsWith("$")) continue;
    if (!Array.isArray(states) || states.length === 0 || !states.every((state) => typeof state === "string" && state !== "")) {
      problems.push(`${journeyId}: expected a non-empty array of state ids`);
    } else if (new Set(states).size !== states.length) {
      problems.push(`${journeyId}: a state is listed twice`);
    }
  }
  if (problems.length > 0) throw new Error([`${label} is not a valid expected set:`, ...problems.map((problem) => `  ${problem}`)].join("\n"));
  return /** @type {any} */ (data);
}

/**
 * The census's expected set from the app's journey list and the Playwright projects that run it,
 * sorted. Throws on a journey or a journey's state listed twice, since its recordings would collide.
 * @param {ReadonlyArray<{ id: string, states: ReadonlyArray<{ id: string }> }>} journeys
 * @param {readonly string[]} projects
 * @returns {Expected}
 */
export function expectedFromJourneys(journeys, projects) {
  const expected = { $projects: [...projects] };
  for (const journey of journeys) {
    if (Object.hasOwn(expected, journey.id)) throw new Error(`Ouro census: journey ${journey.id} is listed twice.`);
    expected[journey.id] = journey.states.map((state) => state.id);
  }
  return sortExpected(validateExpected(expected, "the census list"));
}

function sortExpected(expected) {
  const journeys = Object.keys(expected).filter((key) => !key.startsWith("$")).sort(compareStrings);
  return { $projects: [...expected.$projects].sort(compareStrings), ...Object.fromEntries(journeys.map((journeyId) => [journeyId, [...expected[journeyId]].sort(compareStrings)])) };
}

/**
 * Everything a census fails to cover: a project that recorded nothing, each expected
 * (project, journey, state) not recorded, each recorded one the expected set does not list, and
 * each project recorded that the expected set does not list.
 * @param {Record<string, any>} census
 * @param {Expected} expected
 * @returns {string[]}
 * @claim "Everything a census fails to cover" scripts/kits/census-update.test.mjs verify:testExists(scripts/kits/census-update.test.mjs::census files > names every state a census fails to cover, and every state it records that the list lacks)
 */
export function coverageProblems(census, expected) {
  const projects = expected.$projects;
  const journeys = Object.keys(expected).filter((key) => !key.startsWith("$")).sort(compareStrings);
  const problems = [];
  const extra = Object.keys(census).filter((project) => !project.startsWith("$") && !projects.includes(project)).sort(compareStrings);
  if (extra.length > 0) problems.push(`project(s) ${extra.join(", ")} recorded but not in the expected set's $projects`);
  const missingProjects = projects.filter((project) => !isPlainObject(census[project]) || Object.keys(census[project]).length === 0);
  if (missingProjects.length > 0) problems.push(`no census recorded for project(s) ${missingProjects.join(", ")}`);
  for (const project of projects.filter((name) => !missingProjects.includes(name))) {
    const recorded = census[project];
    for (const journeyId of journeys) {
      for (const stateId of [...expected[journeyId]].sort(compareStrings)) {
        if (!Array.isArray(recorded[journeyId]?.[stateId])) problems.push(`${project} / ${journeyId} / ${stateId} was not recorded`);
      }
    }
    for (const journeyId of Object.keys(recorded).sort(compareStrings)) {
      for (const stateId of Object.keys(recorded[journeyId]).sort(compareStrings)) {
        if (!expected[journeyId]?.includes(stateId)) problems.push(`${project} / ${journeyId} / ${stateId} is recorded but not in the census list`);
      }
    }
  }
  return problems;
}

/**
 * @param {string} name
 * @returns {{ project: string, worker: number } | null}
 */
export function parseWorkerFileName(name) {
  const match = WORKER_FILE_PATTERN.exec(name);
  return match ? { project: match[1], worker: Number(match[2]) } : null;
}

/**
 * @param {string} project
 * @param {number} worker
 */
export function workerFileName(project, worker) {
  return `${ACTUAL_FILE.replace(/\.json$/, "")}.${project}.${worker}.json`;
}

/**
 * Merges the per-worker census files into one, deterministically (sorted, whatever order the files
 * come in), carrying the expected set under `$expected`. Fails on a file that is not a census, a
 * journey/state recorded twice, or a census that does not cover the expected set on every project
 * (a project that recorded nothing, a state not recorded, a state the census list does not have).
 * @param {Array<{ file: string, data: unknown }>} files
 * @param {Expected} expected
 * @claim "Fails on a file that is not a census" scripts/kits/census-update.test.mjs verify:testExists(scripts/kits/census-update.test.mjs::mergeActuals > fails on a journey/state recorded twice and on a missing project)
 * @claim "Fails on a file that is not a census" scripts/kits/census-update.test.mjs verify:testExists(scripts/kits/census-update.test.mjs::mergeActuals > fails on a file that is not a census)
 */
export function mergeActuals(files, expected) {
  const merged = {};
  const recordedIn = new Map();
  const problems = [];
  for (const { file, data } of [...files].sort((a, b) => compareStrings(a.file, b.file))) {
    const census = validateCensus(data, file);
    for (const [project, journeys] of Object.entries(census)) {
      if (project.startsWith("$")) continue;
      merged[project] ??= {};
      for (const [journeyId, states] of Object.entries(journeys)) {
        merged[project][journeyId] ??= {};
        for (const [stateId, multiset] of Object.entries(states)) {
          const key = `${project} / ${journeyId} / ${stateId}`;
          if (recordedIn.has(key)) {
            problems.push(`${key} is recorded twice (${recordedIn.get(key)} and ${file})`);
            continue;
          }
          recordedIn.set(key, file);
          merged[project][journeyId][stateId] = multiset;
        }
      }
    }
  }
  problems.push(...coverageProblems(merged, expected));
  if (problems.length > 0) throw new Error(["Ouro census merge failed:", ...problems.map((problem) => `  ${problem}`)].join("\n"));
  return { $expected: sortExpected(expected), ...sortCensus(merged) };
}

function stateEntries(census) {
  const entries = [];
  for (const [project, journeys] of Object.entries(census)) {
    if (project.startsWith("$")) continue;
    for (const [journey, states] of Object.entries(journeys)) {
      for (const [state, multiset] of Object.entries(states)) entries.push({ project, journey, state, multiset });
    }
  }
  return entries.sort((a, b) => compareStrings(`${a.project}\0${a.journey}\0${a.state}`, `${b.project}\0${b.journey}\0${b.state}`));
}

/**
 * Unmarked controls per project, journey and state.
 * @param {Record<string, any>} census
 * @returns {Record<string, Record<string, Record<string, number>>>}
 */
export function unmarkedCounts(census) {
  const counts = {};
  for (const { project, journey, state, multiset } of stateEntries(census)) {
    ((counts[project] ??= {})[journey] ??= {})[state] = multiset
      .filter(({ identity }) => parseIdentity(identity).control === UNMARKED)
      .reduce((total, { count }) => total + count, 0);
  }
  return counts;
}

/**
 * States (per project) whose unmarked count rose from the previous baseline. Each state is its own
 * ratchet, so a fall in one state never pays for a rise in another. A state (or journey) the
 * previous baseline does not have is new measurement, not a regression.
 * @param {Record<string, any>} previous
 * @param {Record<string, any>} next
 * @returns {Array<{ project: string, journey: string, state: string, from: number, to: number }>}
 * @claim "Each state is its own ratchet" scripts/kits/census-update.test.mjs verify:testExists(scripts/kits/census-update.test.mjs::the unmarked ratchet > refuses a rise in one state even when another state of the journey falls by as much)
 */
export function findRegressions(previous, next) {
  const before = unmarkedCounts(previous);
  const after = unmarkedCounts(next);
  const regressions = [];
  for (const { project, journey, state } of stateEntries(next)) {
    const from = before[project]?.[journey]?.[state];
    const to = after[project][journey][state];
    if (from !== undefined && to > from) regressions.push({ project, journey, state, from, to });
  }
  return regressions;
}

/**
 * Every (project, journey, state) the previous baseline has and the next one does not.
 * @param {Record<string, any>} previous
 * @param {Record<string, any>} next
 * @returns {Array<{ project: string, journey: string, state: string }>}
 * @claim "the previous baseline has and the next one does not" scripts/kits/census-update.test.mjs verify:testExists(scripts/kits/census-update.test.mjs::the unmarked ratchet > names a dropped state by its journey or by project/journey/state)
 */
export function findDrops(previous, next) {
  return stateEntries(previous)
    .filter(({ project, journey, state }) => !Array.isArray(next[project]?.[journey]?.[state]))
    .map(({ project, journey, state }) => ({ project, journey, state }));
}

/**
 * Whether a `--remove` value names a dropped state: `<journey>` names every state of the journey on
 * every project, `<project>/<journey>/<state>` names one.
 * @param {string} removal
 * @param {{ project: string, journey: string, state: string }} drop
 * @claim "value names a dropped state" scripts/kits/census-update.test.mjs verify:testExists(scripts/kits/census-update.test.mjs::the unmarked ratchet > refuses a dropped state until --remove names it on every project, and a --remove that names nothing dropped)
 */
export function removalNames(removal, drop) {
  const parts = removal.split("/");
  if (parts.length === 1) return parts[0] === drop.journey;
  return parts.length === 3 && parts[0] === drop.project && parts[1] === drop.journey && parts[2] === drop.state;
}

const stateLabel = ({ project, journey, state }) => `${project} / ${journey} / ${state}`;

const sum = (counts) => Object.values(counts).reduce((total, count) => total + count, 0);

/**
 * Removed journeys (or states) replaced by new ones in the same update whose unmarked count is
 * higher: a rename carries the old count, so the new name may not start above it. Per project, the
 * journeys the previous baseline has and the next lacks are compared, in total, with the journeys
 * the next has and the previous lacks; within a journey both have, its removed states with its new
 * states. A new project, or new journeys or states with nothing removed beside them, are measurement.
 * @param {Record<string, any>} previous
 * @param {Record<string, any>} next
 * @returns {Array<{ project: string, journey: string, state?: string, replaces: string, from: number, to: number }>}
 */
export function findReplacements(previous, next) {
  const before = unmarkedCounts(previous);
  const after = unmarkedCounts(next);
  const replacements = [];
  for (const project of Object.keys(after).sort(compareStrings)) {
    const was = before[project];
    if (!was) continue;
    const now = after[project];
    const removed = Object.keys(was).filter((journey) => !now[journey]).sort(compareStrings);
    const added = Object.keys(now).filter((journey) => !was[journey]).sort(compareStrings);
    if (removed.length > 0 && added.length > 0) {
      const from = removed.reduce((total, journey) => total + sum(was[journey]), 0);
      const to = added.reduce((total, journey) => total + sum(now[journey]), 0);
      if (to > from) replacements.push({ project, journey: added.join(", "), replaces: removed.join(", "), from, to });
    }
    for (const journey of Object.keys(now).filter((id) => was[id]).sort(compareStrings)) {
      const removedStates = Object.keys(was[journey]).filter((state) => now[journey][state] === undefined).sort(compareStrings);
      const addedStates = Object.keys(now[journey]).filter((state) => was[journey][state] === undefined).sort(compareStrings);
      if (removedStates.length === 0 || addedStates.length === 0) continue;
      const from = removedStates.reduce((total, state) => total + was[journey][state], 0);
      const to = addedStates.reduce((total, state) => total + now[journey][state], 0);
      if (to > from) replacements.push({ project, journey, state: addedStates.join(", "), replaces: removedStates.join(", "), from, to });
    }
  }
  return replacements;
}

/**
 * A regression's label: `project / journey / state`, or `project / journey` for new journeys, then
 * `(replacing ...)` for a rename.
 * @param {{ project: string, journey: string, state?: string, replaces?: string }} regression
 */
export function regressionLabel({ project, journey, state, replaces }) {
  const where = state === undefined ? `${project} / ${journey}` : stateLabel({ project, journey, state });
  return replaces === undefined ? where : `${where} (replacing ${replaces})`;
}

/**
 * The new baseline from a merged actual, which must cover its expected set (`$expected`) on every
 * project. Refuses one that drops a project/journey/state the previous baseline has unless a
 * `remove` entry names it (a renamed journey or state is a drop plus a new one) and `removeReason`
 * says why, a `remove` entry that names nothing dropped, and one that raises a state's unmarked
 * count, or replaces removed journeys or states with new ones holding more unmarked controls,
 * unless `allowRegression` gives a reason. Allowed regressions are recorded under
 * `$allowedRegressions` and removals, with each state's unmarked count, under `$removed`; the next
 * update keeps neither unless it allows or removes something again.
 * @param {{ previous: Record<string, any>, actual: Record<string, any>, allowRegression?: string, remove?: readonly string[], removeReason?: string }} options
 * @claim "The new baseline from a merged actual" scripts/kits/census-update.test.mjs verify:testExists(scripts/kits/census-update.test.mjs::the unmarked ratchet > refuses an actual that records a project as {}, misses a project or a listed state, has no expected set, or has a bad shape)
 * @claim "Allowed regressions are recorded under" scripts/kits/census-update.test.mjs verify:testExists(scripts/kits/census-update.test.mjs::the unmarked ratchet > records an allowed regression with its reason, and drops it on the next update that raises nothing)
 */
export function updateBaseline({ previous, actual, allowRegression, remove = [], removeReason }) {
  validateCensus(previous, "the current baseline");
  validateCensus(actual, "the run's actual census");
  if (actual.$expected === undefined) {
    throw new Error(`the run's actual census has no $expected set: use the merged ${ACTUAL_FILE} that census-merge.mjs writes for a run.`);
  }
  const expected = validateExpected(actual.$expected, "the run's actual census's $expected");
  requireProjects(actual, expected.$projects, "the run's actual census");
  const uncovered = coverageProblems(actual, expected);
  if (uncovered.length > 0) {
    throw new Error(["Ouro census: the run's actual census does not cover the census list:", ...uncovered.map((problem) => `  ${problem}`)].join("\n"));
  }
  const census = sortCensus(actual);

  const drops = findDrops(previous, census);
  const unnamed = drops.filter((drop) => !remove.some((removal) => removalNames(removal, drop)));
  const unused = remove.filter((removal) => !drops.some((drop) => removalNames(removal, drop)));
  if (unnamed.length > 0 || unused.length > 0) {
    throw new Error(
      [
        ...(unnamed.length > 0
          ? [
              "Ouro census: this run drops states the baseline has:",
              ...unnamed.map((drop) => `  ${stateLabel(drop)}`),
              'If they are meant to go (a renamed journey or state is a drop plus a new one), name each with --remove <project/journey/state>, or a whole journey with --remove <journey>, and say why with --remove-reason "<reason>".',
            ]
          : []),
        ...unused.map((removal) => `Ouro census: --remove ${removal} names nothing this run drops.`),
      ].join("\n"),
    );
  }
  const whyRemoved = normalizeName(removeReason);
  if (drops.length > 0 && !whyRemoved) {
    throw new Error('Ouro census: say why with --remove-reason "<reason>"; the baseline records it under $removed with each removed state\'s unmarked count.');
  }

  const regressions = [...findRegressions(previous, census), ...findReplacements(previous, census)];
  const reason = normalizeName(allowRegression);
  if (regressions.length > 0 && !reason) {
    throw new Error(
      [
        "Ouro census: unmarked controls may only fall, state by state. This run raises:",
        ...regressions.map((regression) => `  ${regressionLabel(regression)}: ${regression.from} → ${regression.to} unmarked`),
        'Use Ouro components instead, or record why with --allow-regression "<reason>" (review treats it as a finding).',
      ].join("\n"),
    );
  }
  const before = unmarkedCounts(previous);
  const baseline = {
    ...(regressions.length > 0 ? { $allowedRegressions: regressions.map((regression) => ({ ...regression, reason })) } : {}),
    ...(drops.length > 0
      ? { $removed: drops.map((drop) => ({ key: stateLabel(drop), unmarked: before[drop.project][drop.journey][drop.state], reason: whyRemoved })) }
      : {}),
    ...census,
  };
  return { baseline, regressions, removed: drops };
}

/**
 * One line per project/journey/state added, removed or changed between two census files.
 * @param {Record<string, any>} previous
 * @param {Record<string, any>} next
 * @returns {string[]}
 * @claim "One line per project/journey/state" scripts/kits/census-update.test.mjs verify:testExists(scripts/kits/census-update.test.mjs::the unmarked ratchet > summarizes new, dropped and changed states)
 */
export function summarizeChanges(previous, next) {
  const lines = [];
  const keys = (census) => {
    const result = new Map();
    for (const [project, journeys] of Object.entries(census)) {
      if (project.startsWith("$")) continue;
      for (const [journeyId, states] of Object.entries(journeys)) {
        for (const [stateId, multiset] of Object.entries(states)) result.set(`${project} / ${journeyId} / ${stateId}`, multiset);
      }
    }
    return result;
  };
  const before = keys(previous);
  const after = keys(next);
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort(compareStrings)) {
    if (!before.has(key)) lines.push(`  new state  ${key}`);
    else if (!after.has(key)) lines.push(`  dropped    ${key}`);
    else {
      const diff = formatDiff(diffMultisets(before.get(key), after.get(key)));
      if (diff.length > 0) lines.push(`  changed    ${key}`, ...diff.map((line) => `  ${line}`));
    }
  }
  return lines;
}

/**
 * Every (project, journey, state) whose multiset differs between two runs' censuses, or that only
 * one of them recorded. Two runs of the same commit must record identical censuses; any line here
 * is nondeterminism to remove before the census is baselined.
 * @param {Record<string, any>} a
 * @param {Record<string, any>} b
 * @param {{ a: string, b: string }} labels
 * @returns {string[]}
 * @claim "whose multiset differs between two runs' censuses" scripts/kits/census-compare.test.mjs verify:testExists(scripts/kits/census-compare.test.mjs::compareCensuses > names every state only one run recorded and every identity that differs)
 * @claim "Two runs of the same commit must record identical censuses" scripts/kits/census-compare.test.mjs verify:testExists(scripts/kits/census-compare.test.mjs::census-compare.mjs > fails, naming every difference, when two runs differ)
 */
export function compareCensuses(a, b, labels) {
  const states = (census) => {
    const result = new Map();
    for (const [project, journeys] of Object.entries(census)) {
      if (project.startsWith("$")) continue;
      for (const [journeyId, byState] of Object.entries(journeys)) {
        for (const [stateId, multiset] of Object.entries(byState)) result.set(`${project} / ${journeyId} / ${stateId}`, multiset);
      }
    }
    return result;
  };
  const left = states(a);
  const right = states(b);
  const lines = [];
  for (const key of [...new Set([...left.keys(), ...right.keys()])].sort(compareStrings)) {
    if (!right.has(key)) lines.push(`  only in ${labels.a}: ${key}`);
    else if (!left.has(key)) lines.push(`  only in ${labels.b}: ${key}`);
    else {
      const diff = formatDiff(diffMultisets(left.get(key), right.get(key)));
      if (diff.length > 0) lines.push(`  differs    ${key} (${labels.a} → ${labels.b})`, ...diff.map((line) => `  ${line}`));
    }
  }
  return lines;
}
