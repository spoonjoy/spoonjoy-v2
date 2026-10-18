// The HX census's pure logic, shared by the census journey (e2e/journeys/hx-census.journey.ts),
// the merge step (scripts/hx-census-merge.mjs) and the baseline update (scripts/hx-census-update.mjs).
//
// A control's identity is one line: its role, its normalized accessible name (JSON-quoted), its HX
// marker and part (`data-ouro-control` / `data-ouro-part`, "-" when absent) and its context (the
// nearest ancestor landmark, dialog or named group/region, else the nearest data-testid, else "-"):
//
//   button "Save" [-/-] in main
//   option "Weeknight Dinners" [select/item] in dialog "Save to cookbook"
//   link "Recipes" [-/-] in testid "recipe-header-actions"
//
// Never a DOM position. A state's census is the exact multiset of its visible controls' identities:
// `[{ identity, count }]`, sorted by identity. A census file (a worker's actual, the merged actual, or
// the baseline) is `{ [project]: { [journeyId]: { [stateId]: Multiset } } }`; keys starting with "$"
// are metadata (the merged actual's `$expected`, the baseline's `$allowedRegressions`), never projects.

/** The device projects every census run must record (playwright.journeys.config.ts). */
export const CENSUS_PROJECTS = Object.freeze(["iphone-webkit", "desktop-chrome"]);

export const BASELINE_PATH = "e2e/journeys/hx-census.baseline.json";
export const ACTUAL_FILE = "hx-census-actual.json";
/** The expected set the census journey writes beside its worker files: `{ [journeyId]: [stateId, ...] }`. */
export const EXPECTED_FILE = "hx-census-expected.json";
export const ARTIFACT_NAME = "hx-census-actual";
export const UNMARKED = "-";

const WORKER_FILE_PATTERN = /^hx-census-actual\.(.+)\.(\d+)\.json$/;
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
 * and, for an enrolled journey, every unmarked identity or marker naming an item HX does not have.
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
 */
export function checkCensusState({ baseline, project, journeyId, stateId, actual, enrolled, knownItems, actualPath, baselinePath = BASELINE_PATH }) {
  const label = `${project} / ${journeyId} / ${stateId}`;
  const update = `pnpm census:update <run-id>`;
  const problems = [];
  const expected = /** @type {any} */ (baseline)?.[project]?.[journeyId]?.[stateId];
  if (!Array.isArray(expected)) {
    problems.push(
      `HX census: no baseline for ${label} in ${baselinePath}: run ${update} once this run's artifact is uploaded. ` +
        `This run's actual multiset is in ${actualPath} (the Journeys workflow uploads it, merged, as the run's ${ARTIFACT_NAME} artifact).`,
    );
  } else {
    const lines = formatDiff(diffMultisets(expected, actual));
    if (lines.length > 0) {
      problems.push(
        [`HX census: ${label} differs from ${baselinePath}:`, ...lines, `If the change is intended, run ${update} and commit the baseline. Actual multiset: ${actualPath}.`].join("\n"),
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
      problems.push([`HX census: ${journeyId} is enrolled, so every control must be HX's; unmarked in ${label}:`, ...unmarked.map(({ identity, count }) => `  ${identity} ×${count}`)].join("\n"));
    }
    if (unknown.length > 0) {
      problems.push([`HX census: ${label} has markers naming no installed HX item:`, ...unknown.map(({ identity, count }) => `  ${identity} ×${count}`)].join("\n"));
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
 * Throws, naming every problem, unless `data` is the census's expected set: `{ [journeyId]: [stateId, ...] }`,
 * every journey with at least one state, no state listed twice.
 * @param {unknown} data
 * @param {string} label
 * @returns {Record<string, string[]>}
 */
export function validateExpected(data, label) {
  if (!isPlainObject(data) || Object.keys(data).length === 0) {
    throw new Error(`${label}: the expected set is a non-empty JSON object of journeys, each listing its states.`);
  }
  const problems = [];
  for (const [journeyId, states] of Object.entries(data)) {
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
 * The census's expected set from its journey list (support/hx-census.ts), sorted. Throws on a
 * journey or a journey's state listed twice, since its recordings would collide.
 * @param {ReadonlyArray<{ id: string, states: ReadonlyArray<{ id: string }> }>} journeys
 * @returns {Record<string, string[]>}
 */
export function expectedFromJourneys(journeys) {
  const expected = {};
  for (const journey of journeys) {
    if (Object.hasOwn(expected, journey.id)) throw new Error(`HX census: journey ${journey.id} is listed twice.`);
    expected[journey.id] = journey.states.map((state) => state.id);
  }
  return sortExpected(validateExpected(expected, "the census list"));
}

function sortExpected(expected) {
  return Object.fromEntries(Object.keys(expected).sort(compareStrings).map((journeyId) => [journeyId, [...expected[journeyId]].sort(compareStrings)]));
}

/**
 * Everything a census fails to cover: a project that recorded nothing, each expected
 * (project, journey, state) not recorded, and each recorded one the expected set does not list.
 * @param {Record<string, any>} census
 * @param {Record<string, string[]>} expected
 * @param {readonly string[]} projects
 * @returns {string[]}
 */
export function coverageProblems(census, expected, projects) {
  const problems = [];
  const missingProjects = projects.filter((project) => !isPlainObject(census[project]) || Object.keys(census[project]).length === 0);
  if (missingProjects.length > 0) problems.push(`no census recorded for project(s) ${missingProjects.join(", ")}`);
  for (const project of projects.filter((name) => !missingProjects.includes(name))) {
    const recorded = census[project];
    for (const journeyId of Object.keys(expected).sort(compareStrings)) {
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
 * @param {Record<string, string[]>} expected
 * @param {readonly string[]} [projects]
 */
export function mergeActuals(files, expected, projects = CENSUS_PROJECTS) {
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
  problems.push(...coverageProblems(merged, expected, projects));
  if (problems.length > 0) throw new Error(["HX census merge failed:", ...problems.map((problem) => `  ${problem}`)].join("\n"));
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
 */
export function removalNames(removal, drop) {
  const parts = removal.split("/");
  if (parts.length === 1) return parts[0] === drop.journey;
  return parts.length === 3 && parts[0] === drop.project && parts[1] === drop.journey && parts[2] === drop.state;
}

const stateLabel = ({ project, journey, state }) => `${project} / ${journey} / ${state}`;

/**
 * The new baseline from a merged actual, which must cover its expected set (`$expected`) on every
 * project. Refuses one that drops a project/journey/state the previous baseline has unless a
 * `remove` entry names it (a renamed journey or state is a drop plus a new one), a `remove` entry
 * that names nothing dropped, and one that raises a state's unmarked count unless `allowRegression`
 * gives a reason, which is then recorded under `$allowedRegressions` (dropped again by the next
 * update that raises nothing).
 * @param {{ previous: Record<string, any>, actual: Record<string, any>, allowRegression?: string, remove?: readonly string[], projects?: readonly string[] }} options
 */
export function updateBaseline({ previous, actual, allowRegression, remove = [], projects = CENSUS_PROJECTS }) {
  validateCensus(previous, "the current baseline");
  validateCensus(actual, "the run's actual census");
  requireProjects(actual, projects, "the run's actual census");
  if (actual.$expected === undefined) {
    throw new Error("the run's actual census has no $expected set: use the merged hx-census-actual.json a Journeys run uploads.");
  }
  const expected = validateExpected(actual.$expected, "the run's actual census's $expected");
  const uncovered = coverageProblems(actual, expected, projects);
  if (uncovered.length > 0) {
    throw new Error(["HX census: the run's actual census does not cover the census list:", ...uncovered.map((problem) => `  ${problem}`)].join("\n"));
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
              "HX census: this run drops states the baseline has:",
              ...unnamed.map((drop) => `  ${stateLabel(drop)}`),
              "If they are meant to go (a renamed journey or state is a drop plus a new one), name each with --remove <project/journey/state>, or a whole journey with --remove <journey>.",
            ]
          : []),
        ...unused.map((removal) => `HX census: --remove ${removal} names nothing this run drops.`),
      ].join("\n"),
    );
  }

  const regressions = findRegressions(previous, census);
  const reason = normalizeName(allowRegression);
  if (regressions.length > 0 && !reason) {
    throw new Error(
      [
        "HX census: unmarked controls may only fall, state by state. This run raises:",
        ...regressions.map((regression) => `  ${stateLabel(regression)}: ${regression.from} → ${regression.to} unmarked`),
        'Use HX components instead, or record why with --allow-regression "<reason>" (review treats it as a finding).',
      ].join("\n"),
    );
  }
  const baseline = regressions.length > 0
    ? { $allowedRegressions: regressions.map((regression) => ({ ...regression, reason })), ...census }
    : census;
  return { baseline, regressions, removed: drops };
}

/**
 * One line per project/journey/state added, removed or changed between two census files.
 * @param {Record<string, any>} previous
 * @param {Record<string, any>} next
 * @returns {string[]}
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
