import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { pathToFileURL } from "node:url";
import {
  ACTUAL_FILE,
  BASELINE_PATH,
  CENSUS_PROJECTS,
  checkCensusState,
  coverageProblems,
  controlIdentity,
  diffMultisets,
  EXPECTED_FILE,
  expectedFromJourneys,
  findDrops,
  findRegressions,
  formatDiff,
  identityContext,
  mergeActuals,
  normalizeMarker,
  normalizeName,
  parseIdentity,
  parseWorkerFileName,
  removalNames,
  requireProjects,
  sortCensus,
  stringifyCensus,
  summarizeChanges,
  toMultiset,
  unmarkedCounts,
  updateBaseline,
  validateCensus,
  validateExpected,
  workerFileName,
} from "../../scripts/hx-census.mjs";
import * as update from "../../scripts/hx-census-update.mjs";
import * as merge from "../../scripts/hx-census-merge.mjs";
import { expectConsoleError } from "../warning-policy";

const SAVE = 'button "Save" [-/-] in main';
const SAVE_MARKED = 'button "Save" [button/root] in main';
const CLOSE = 'button "Close" [-/-] in dialog "Save to cookbook"';
const LINK = 'link "Recipes" [link/-] in navigation "Spoonjoy navigation"';

function census(journeys: Record<string, Record<string, Array<{ identity: string; count: number }>>>, projects = CENSUS_PROJECTS) {
  return Object.fromEntries(projects.map((project) => [project, journeys]));
}

type Journeys = Record<string, Record<string, Array<{ identity: string; count: number }>>>;

/** A merged actual: the census on every project, carrying the expected set its journeys cover. */
function merged(journeys: Journeys) {
  const expected = Object.fromEntries(Object.entries(journeys).map(([journey, states]) => [journey, Object.keys(states).sort()]));
  return { $expected: expected, ...census(journeys) };
}

function io() {
  return { log: vi.fn(), error: vi.fn() };
}

describe("identity", () => {
  it("normalizes a name's whitespace and keeps its case and punctuation", () => {
    expect(normalizeName("  Save\n\tto   Cookbook\u00a0!  ")).toBe("Save to Cookbook !");
    expect(normalizeName(null)).toBe("");
    expect(normalizeName(undefined)).toBe("");
  });

  it("replaces relative times and calendar dates, which depend on the run, with placeholders", () => {
    for (const phrase of [
      "2 minutes ago",
      "1 minute ago",
      "5 seconds ago",
      "3 hours ago",
      "1 day ago",
      "2 weeks ago",
      "4 months ago",
      "1 year ago",
      "12 min ago",
      "1 hr ago",
      "2 mo ago",
      "3 yr ago",
      "less than a minute ago",
      "about an hour ago",
      "just now",
      "Just now",
      "yesterday",
    ]) {
      expect(normalizeName(`qa_kitchen_friend 1 spoon · 1 save ${phrase}`), phrase).toBe("qa_kitchen_friend 1 spoon · 1 save <relative time>");
    }
    expect(normalizeName("Latest activity Oct 18, 2026")).toBe("Latest activity <date>");
    expect(normalizeName("Latest activity September 3, 2025 and Jun 2026")).toBe("Latest activity <date> and <date>");
    expect(normalizeName("Sept. 30, 2026")).toBe("<date>");
    expect(normalizeName("Mayonnaise 2026 · 30 minutes · 4 servings · ago")).toBe("Mayonnaise 2026 · 30 minutes · 4 servings · ago");
    expect(controlIdentity({ role: "link", name: "qa_kitchen_friend\n2 minutes ago", landmark: { role: "main" } })).toBe(
      'link "qa_kitchen_friend <relative time>" [-/-] in main',
    );
  });

  it("makes a marker one token, and '-' when it is absent or blank", () => {
    expect(normalizeMarker(null)).toBe("-");
    expect(normalizeMarker(undefined)).toBe("-");
    expect(normalizeMarker("   ")).toBe("-");
    expect(normalizeMarker(" checkbox ")).toBe("checkbox");
    expect(normalizeMarker("check box")).toBe("check_box");
    expect(normalizeMarker("a/b[c]")).toBe("a_b_c_");
  });

  it("takes the landmark as context, then the nearest data-testid, then '-'", () => {
    expect(identityContext({ landmark: { role: "dialog", name: " Save to\ncookbook " }, testId: "x" })).toBe('dialog "Save to cookbook"');
    expect(identityContext({ landmark: { role: "main", name: "" } })).toBe("main");
    expect(identityContext({ landmark: { role: "main" } })).toBe("main");
    expect(identityContext({ landmark: null, testId: "recipe-header-actions" })).toBe('testid "recipe-header-actions"');
    expect(identityContext({ testId: "  " })).toBe("-");
    expect(identityContext({})).toBe("-");
  });

  it("builds an identity from role, name, marker, part and context, never position", () => {
    expect(controlIdentity({ role: "button", name: "  Save ", landmark: { role: "main", name: "" } })).toBe(SAVE);
    expect(controlIdentity({ role: "option", name: "Soups", control: "select", part: "item", landmark: { role: "listbox", name: "Uses" } }))
      .toBe('option "Soups" [select/item] in listbox "Uses"');
    expect(controlIdentity({ role: "", name: 'Say "hi"', testId: "card" })).toBe('generic "Say \\"hi\\"" [-/-] in testid "card"');
    expect(controlIdentity({ role: "link", name: "Home" })).toBe('link "Home" [-/-] in -');
  });

  it("parses an identity back into its parts", () => {
    expect(parseIdentity('generic "Say \\"hi\\" [x/y] in z" [-/-] in testid "card"')).toEqual({
      role: "generic",
      name: 'Say "hi" [x/y] in z',
      control: "-",
      part: "-",
      context: 'testid "card"',
    });
    expect(parseIdentity(SAVE_MARKED)).toMatchObject({ control: "button", part: "root", context: "main" });
    expect(() => parseIdentity("button Save")).toThrow('Not a census identity: "button Save"');
  });
});

describe("multisets", () => {
  it("counts identities and sorts them", () => {
    expect(toMultiset([SAVE, CLOSE, SAVE])).toEqual([
      { identity: CLOSE, count: 1 },
      { identity: SAVE, count: 2 },
    ]);
    expect(toMultiset([])).toEqual([]);
  });

  it("finds added, removed, duplicated and re-marked controls", () => {
    const diff = diffMultisets(
      [{ identity: SAVE, count: 1 }, { identity: CLOSE, count: 1 }, { identity: 'link "Old" [-/-] in main', count: 1 }],
      [{ identity: SAVE_MARKED, count: 1 }, { identity: CLOSE, count: 2 }, { identity: LINK, count: 1 }],
    );
    expect(diff).toEqual({
      added: [{ identity: LINK, count: 1 }],
      removed: [{ identity: 'link "Old" [-/-] in main', count: 1 }],
      recounted: [{ identity: CLOSE, from: 1, to: 2 }],
      remarked: [{ from: SAVE, to: SAVE_MARKED, count: 1 }],
    });
    expect(formatDiff(diff)).toEqual([
      `  added      ${LINK} ×1`,
      '  removed    link "Old" [-/-] in main ×1',
      `  count      ${CLOSE} ×1 → ×2`,
      `  re-marked  ${SAVE} → ${SAVE_MARKED} ×1`,
    ]);
  });

  it("pairs a re-marked control only when its count is unchanged", () => {
    expect(diffMultisets([{ identity: SAVE, count: 2 }], [{ identity: SAVE_MARKED, count: 1 }])).toEqual({
      added: [{ identity: SAVE_MARKED, count: 1 }],
      removed: [{ identity: SAVE, count: 2 }],
      recounted: [],
      remarked: [],
    });
  });

  it("finds nothing between equal multisets", () => {
    expect(formatDiff(diffMultisets([{ identity: SAVE, count: 1 }], [{ identity: SAVE, count: 1 }]))).toEqual([]);
  });
});

describe("checkCensusState", () => {
  const base = {
    project: "iphone-webkit",
    journeyId: "recipe-owner",
    stateId: "save-dialog",
    enrolled: false,
    knownItems: ["button", "dialog"],
    actualPath: "hx-census/hx-census-actual.iphone-webkit.0.json",
  };

  it("fails with the update command and the actual's path when the baseline lacks the project, journey or state", () => {
    for (const baseline of [{}, { "iphone-webkit": {} }, { "iphone-webkit": { "recipe-owner": {} } }]) {
      const [problem, ...rest] = checkCensusState({ ...base, baseline, actual: [{ identity: SAVE, count: 1 }] });
      expect(rest).toEqual([]);
      expect(problem).toContain("HX census: no baseline for iphone-webkit / recipe-owner / save-dialog in e2e/journeys/hx-census.baseline.json");
      expect(problem).toContain("run pnpm census:update <run-id>");
      expect(problem).toContain("hx-census/hx-census-actual.iphone-webkit.0.json");
    }
  });

  it("passes an exact match and prints a readable diff otherwise", () => {
    const baseline = census({ "recipe-owner": { "save-dialog": [{ identity: SAVE, count: 1 }] } });
    expect(checkCensusState({ ...base, baseline, actual: [{ identity: SAVE, count: 1 }] })).toEqual([]);
    expect(checkCensusState({ ...base, baseline, baselinePath: "b.json", actual: [{ identity: SAVE, count: 2 }] })).toEqual([
      [
        "HX census: iphone-webkit / recipe-owner / save-dialog differs from b.json:",
        `  count      ${SAVE} ×1 → ×2`,
        "If the change is intended, run pnpm census:update <run-id> and commit the baseline. Actual multiset: hx-census/hx-census-actual.iphone-webkit.0.json.",
      ].join("\n"),
    ]);
  });

  it("lets an unenrolled journey hold unmarked controls", () => {
    const baseline = census({ "recipe-owner": { "save-dialog": [{ identity: SAVE, count: 1 }] } });
    expect(checkCensusState({ ...base, baseline, actual: [{ identity: SAVE, count: 1 }] })).toEqual([]);
  });

  it("fails an enrolled journey on any unmarked control or unknown item, even when the baseline matches", () => {
    const actual = [{ identity: SAVE, count: 2 }, { identity: LINK, count: 1 }, { identity: SAVE_MARKED, count: 1 }];
    const baseline = census({ "recipe-owner": { "save-dialog": actual } });
    expect(checkCensusState({ ...base, enrolled: true, baseline, actual })).toEqual([
      `HX census: recipe-owner is enrolled, so every control must be HX's; unmarked in iphone-webkit / recipe-owner / save-dialog:\n  ${SAVE} ×2`,
      `HX census: iphone-webkit / recipe-owner / save-dialog has markers naming no installed HX item:\n  ${LINK} ×1`,
    ]);
    expect(checkCensusState({ ...base, enrolled: true, baseline: census({ "recipe-owner": { "save-dialog": [{ identity: SAVE_MARKED, count: 1 }] } }), actual: [{ identity: SAVE_MARKED, count: 1 }] })).toEqual([]);
  });
});

describe("census files", () => {
  it("accepts a census and skips metadata keys", () => {
    const data = { $allowedRegressions: [1], "iphone-webkit": { home: { default: [{ identity: SAVE, count: 1 }] } } };
    expect(validateCensus(data, "x")).toBe(data);
  });

  it("names every shape problem", () => {
    expect(() => validateCensus([], "x")).toThrow("x: a census file is a JSON object of projects.");
    expect(() => validateCensus(null, "x")).toThrow("a census file is a JSON object");
    let message = "";
    try {
      validateCensus(
        {
          a: [],
          b: { j: "nope" },
          c: {
            j: {
              notArray: {},
              bad: [{ identity: SAVE, count: 0 }, { identity: 3, count: 1 }, "x", { identity: "junk", count: 1 }, { identity: SAVE, count: 1 }, { identity: SAVE, count: 1 }],
            },
          },
        },
        "file.json",
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message.split("\n")).toEqual([
      "file.json is not a valid census file:",
      "  a: expected an object of journeys",
      "  b / j: expected an object of states",
      "  c / j / notArray: expected an array of { identity, count }",
      `  c / j / bad: {"identity":"${SAVE.replaceAll('"', '\\"')}","count":0} is not { identity: string, count: positive integer }`,
      '  c / j / bad: {"identity":3,"count":1} is not { identity: string, count: positive integer }',
      '  c / j / bad: "x" is not { identity: string, count: positive integer }',
      '  c / j / bad: "junk" is not a census identity',
      `  c / j / bad: ${SAVE} is listed twice`,
    ]);
  });

  it("sorts keys and multisets and drops metadata", () => {
    const sorted = sortCensus({
      $allowedRegressions: [],
      z: { b: { y: [{ identity: SAVE, count: 1 }, { identity: CLOSE, count: 2, extra: true }] }, a: { x: [] } },
      a: { a: { a: [] } },
    });
    expect(JSON.stringify(sorted)).toBe(
      JSON.stringify({ a: { a: { a: [] } }, z: { a: { x: [] }, b: { y: [{ identity: CLOSE, count: 2 }, { identity: SAVE, count: 1 }] } } }),
    );
    expect(stringifyCensus({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });

  it("requires every project", () => {
    expect(() => requireProjects({ "iphone-webkit": {} }, CENSUS_PROJECTS, "actual")).toThrow(
      "actual is missing project(s) desktop-chrome: every census run records iphone-webkit and desktop-chrome.",
    );
    expect(() => requireProjects({ "iphone-webkit": {}, "desktop-chrome": { home: { default: [] } } }, CENSUS_PROJECTS, "actual")).toThrow(
      "actual records nothing for project(s) iphone-webkit: every census run records every state of every journey.",
    );
    expect(() => requireProjects(census({ home: { default: [] } }), CENSUS_PROJECTS, "actual")).not.toThrow();
  });

  it("validates the expected set and builds it from the census list", () => {
    expect(validateExpected({ home: ["default"] }, "e")).toEqual({ home: ["default"] });
    expect(() => validateExpected([], "e")).toThrow("e: the expected set is a non-empty JSON object of journeys, each listing its states.");
    expect(() => validateExpected({}, "e")).toThrow("e: the expected set is a non-empty JSON object");
    expect(() => validateExpected({ a: [], b: "default", c: [""], d: [1], e: ["x", "x"] }, "e")).toThrow(
      [
        "e is not a valid expected set:",
        "  a: expected a non-empty array of state ids",
        "  b: expected a non-empty array of state ids",
        "  c: expected a non-empty array of state ids",
        "  d: expected a non-empty array of state ids",
        "  e: a state is listed twice",
      ].join("\n"),
    );
    expect(JSON.stringify(expectedFromJourneys([
      { id: "recipe", states: [{ id: "default" }, { id: "cook-mode" }] },
      { id: "home", states: [{ id: "default" }] },
    ]))).toBe(JSON.stringify({ home: ["default"], recipe: ["cook-mode", "default"] }));
    expect(() => expectedFromJourneys([{ id: "home", states: [{ id: "default" }] }, { id: "home", states: [{ id: "x" }] }])).toThrow(
      "HX census: journey home is listed twice.",
    );
    expect(() => expectedFromJourneys([{ id: "home", states: [{ id: "default" }, { id: "default" }] }])).toThrow("home: a state is listed twice");
    expect(() => expectedFromJourneys([{ id: "home", states: [] }])).toThrow("home: expected a non-empty array of state ids");
  });

  it("names every state a census fails to cover, and every state it records that the list lacks", () => {
    const expected = { home: ["default", "menu"], recipe: ["default"] };
    expect(coverageProblems(merged({ home: { default: [], menu: [] }, recipe: { default: [] } }), expected, CENSUS_PROJECTS)).toEqual([]);
    expect(
      coverageProblems(
        { "iphone-webkit": {}, "desktop-chrome": { home: { default: [], stale: [] }, old: { default: [] } } },
        expected,
        [...CENSUS_PROJECTS, "tablet"],
      ),
    ).toEqual([
      "no census recorded for project(s) iphone-webkit, tablet",
      "desktop-chrome / home / menu was not recorded",
      "desktop-chrome / recipe / default was not recorded",
      "desktop-chrome / home / stale is recorded but not in the census list",
      "desktop-chrome / old / default is recorded but not in the census list",
    ]);
  });

  it("names worker files by project and worker index", () => {
    expect(workerFileName("iphone-webkit", 3)).toBe("hx-census-actual.iphone-webkit.3.json");
    expect(parseWorkerFileName("hx-census-actual.desktop-chrome.12.json")).toEqual({ project: "desktop-chrome", worker: 12 });
    expect(parseWorkerFileName(ACTUAL_FILE)).toBeNull();
    expect(parseWorkerFileName("hx-census-actual.iphone-webkit.x.json")).toBeNull();
  });
});

describe("mergeActuals", () => {
  const phone = (journey: string, state: string, identity = SAVE) => ({ "iphone-webkit": { [journey]: { [state]: [{ identity, count: 1 }] } } });
  const desktop = (journey: string, state: string) => ({ "desktop-chrome": { [journey]: { [state]: [{ identity: CLOSE, count: 1 }] } } });

  it("merges worker files into one deterministic census, whatever order they arrive in", () => {
    const files = [
      { file: "w/hx-census-actual.iphone-webkit.1.json", data: phone("recipe", "save-dialog") },
      { file: "w/hx-census-actual.iphone-webkit.0.json", data: { $note: "x", ...phone("home", "default") } },
      { file: "w/hx-census-actual.desktop-chrome.2.json", data: desktop("home", "default") },
      { file: "w/hx-census-actual.iphone-webkit.3.json", data: phone("recipe", "default") },
    ];
    const expected = { recipe: ["save-dialog", "default"], home: ["default"] };
    const result = mergeActuals(files, expected, ["iphone-webkit"]);
    expect(stringifyCensus(result)).toBe(stringifyCensus(mergeActuals([...files].reverse(), expected, ["iphone-webkit"])));
    expect(JSON.stringify(Object.keys(result))).toBe(JSON.stringify(["$expected", "desktop-chrome", "iphone-webkit"]));
    expect(result).toEqual({
      $expected: { home: ["default"], recipe: ["default", "save-dialog"] },
      "desktop-chrome": { home: { default: [{ identity: CLOSE, count: 1 }] } },
      "iphone-webkit": {
        home: { default: [{ identity: SAVE, count: 1 }] },
        recipe: { default: [{ identity: SAVE, count: 1 }], "save-dialog": [{ identity: SAVE, count: 1 }] },
      },
    });
  });

  const home = { home: ["default"] };

  it("fails on a journey/state recorded twice and on a missing project", () => {
    expect(() =>
      mergeActuals(
        [
          { file: "a.json", data: phone("home", "default") },
          { file: "b.json", data: phone("home", "default", CLOSE) },
        ],
        home,
      ),
    ).toThrow(
      "HX census merge failed:\n  iphone-webkit / home / default is recorded twice (a.json and b.json)\n  no census recorded for project(s) desktop-chrome",
    );
    expect(() => mergeActuals([], home, ["solo"])).toThrow("no census recorded for project(s) solo");
    // The same file listed twice records each of its states twice.
    expect(() => mergeActuals([{ file: "a.json", data: phone("home", "default") }, { file: "a.json", data: phone("home", "default") }], home, ["iphone-webkit"]))
      .toThrow("iphone-webkit / home / default is recorded twice (a.json and a.json)");
  });

  it("fails on a project recorded as {} and on a state of the census list that went unrecorded", () => {
    expect(() =>
      mergeActuals([{ file: "a.json", data: { "iphone-webkit": {} } }, { file: "b.json", data: desktop("home", "default") }], home),
    ).toThrow("HX census merge failed:\n  no census recorded for project(s) iphone-webkit");
    expect(() =>
      mergeActuals(
        [{ file: "a.json", data: phone("home", "default") }, { file: "b.json", data: desktop("home", "default") }],
        { home: ["default", "menu"] },
      ),
    ).toThrow("HX census merge failed:\n  iphone-webkit / home / menu was not recorded\n  desktop-chrome / home / menu was not recorded");
  });

  it("fails on a file that is not a census", () => {
    expect(() => mergeActuals([{ file: "bad.json", data: [] }], home)).toThrow("bad.json: a census file is a JSON object of projects.");
  });
});

describe("the unmarked ratchet", () => {
  const one = (identities: Record<string, number>) => Object.entries(identities).map(([identity, count]) => ({ identity, count }));

  it("counts unmarked controls per project, journey and state", () => {
    expect(unmarkedCounts({
      $allowedRegressions: [],
      "iphone-webkit": { recipe: { default: one({ [SAVE]: 2, [SAVE_MARKED]: 1 }), dialog: one({ [CLOSE]: 1 }) }, home: { default: [] } },
    })).toEqual({ "iphone-webkit": { recipe: { default: 2, dialog: 1 }, home: { default: 0 } } });
  });

  it("finds a state whose unmarked count rose, and treats a new state or journey as measurement", () => {
    const previous = { p: { recipe: { default: one({ [SAVE]: 1 }) }, home: { default: one({ [SAVE]: 2 }) } } };
    const next = {
      p: { recipe: { default: one({ [SAVE]: 2 }), dialog: one({ [CLOSE]: 1 }) }, home: { default: one({ [SAVE]: 1 }) }, search: { default: one({ [SAVE]: 9 }) } },
      q: { home: { default: one({ [SAVE]: 1 }) } },
    };
    expect(findRegressions(previous, next)).toEqual([{ project: "p", journey: "recipe", state: "default", from: 1, to: 2 }]);
  });

  it("refuses a rise in one state even when another state of the journey falls by as much", () => {
    const previous = census({ recipe: { default: one({ [SAVE]: 1 }), dialog: one({ [CLOSE]: 2 }) } });
    const actual = merged({ recipe: { default: one({ [SAVE]: 2 }), dialog: one({ [CLOSE]: 1 }) } });
    expect(() => updateBaseline({ previous, actual })).toThrow(
      [
        "HX census: unmarked controls may only fall, state by state. This run raises:",
        "  desktop-chrome / recipe / default: 1 → 2 unmarked",
        "  iphone-webkit / recipe / default: 1 → 2 unmarked",
        'Use HX components instead, or record why with --allow-regression "<reason>" (review treats it as a finding).',
      ].join("\n"),
    );
  });

  it("accepts a new state in a journey the baseline has as measurement", () => {
    const previous = census({ recipe: { default: one({ [SAVE]: 1 }) } });
    const actual = merged({ recipe: { default: one({ [SAVE]: 1 }), "new-dialog": one({ [CLOSE]: 4 }) } });
    const { baseline, regressions, removed } = updateBaseline({ previous, actual });
    expect(regressions).toEqual([]);
    expect(removed).toEqual([]);
    expect(baseline).toEqual(sortCensus(actual));
    expect(baseline).not.toHaveProperty("$expected");
  });

  it("writes the first baseline from an empty one", () => {
    const actual = merged({ home: { default: one({ [SAVE]: 3 }) } });
    expect(updateBaseline({ previous: {}, actual })).toEqual({ baseline: sortCensus(actual), regressions: [], removed: [] });
  });

  it("refuses a baseline that raises a state's unmarked count without --allow-regression", () => {
    const previous = census({ home: { default: one({ [SAVE]: 1 }) } });
    const actual = merged({ home: { default: one({ [SAVE]: 2 }) } });
    expect(() => updateBaseline({ previous, actual })).toThrow(
      [
        "HX census: unmarked controls may only fall, state by state. This run raises:",
        "  desktop-chrome / home / default: 1 → 2 unmarked",
        "  iphone-webkit / home / default: 1 → 2 unmarked",
        'Use HX components instead, or record why with --allow-regression "<reason>" (review treats it as a finding).',
      ].join("\n"),
    );
    expect(() => updateBaseline({ previous, actual, allowRegression: "   " })).toThrow("unmarked controls may only fall");
  });

  it("records an allowed regression with its reason, and drops it on the next update that raises nothing", () => {
    const previous = census({ home: { default: one({ [SAVE]: 1 }) } });
    const actual = merged({ home: { default: one({ [SAVE]: 2 }) } });
    const { baseline, regressions } = updateBaseline({ previous, actual, allowRegression: " new search row " });
    expect(regressions).toHaveLength(2);
    expect(Object.keys(baseline)[0]).toBe("$allowedRegressions");
    expect(baseline.$allowedRegressions).toEqual([
      { project: "desktop-chrome", journey: "home", state: "default", from: 1, to: 2, reason: "new search row" },
      { project: "iphone-webkit", journey: "home", state: "default", from: 1, to: 2, reason: "new search row" },
    ]);
    const again = updateBaseline({ previous: baseline, actual, allowRegression: "ignored" });
    expect(again.regressions).toEqual([]);
    expect(again.baseline).toEqual(sortCensus(actual));
  });

  it("lets marked controls rise and unmarked ones fall", () => {
    const previous = census({ home: { default: one({ [SAVE]: 2 }) } });
    const actual = merged({ home: { default: one({ [SAVE]: 1, [SAVE_MARKED]: 5 }) } });
    expect(updateBaseline({ previous, actual }).regressions).toEqual([]);
  });

  it("names a dropped state by its journey or by project/journey/state", () => {
    const drop = { project: "iphone-webkit", journey: "recipe", state: "dialog" };
    expect(removalNames("recipe", drop)).toBe(true);
    expect(removalNames("home", drop)).toBe(false);
    expect(removalNames("iphone-webkit/recipe/dialog", drop)).toBe(true);
    expect(removalNames("desktop-chrome/recipe/dialog", drop)).toBe(false);
    expect(removalNames("iphone-webkit/home/dialog", drop)).toBe(false);
    expect(removalNames("iphone-webkit/recipe/default", drop)).toBe(false);
    expect(removalNames("recipe/dialog", drop)).toBe(false);
    expect(findDrops(
      { $allowedRegressions: [], p: { recipe: { default: [], dialog: [] }, gone: { default: [] } } },
      { p: { recipe: { default: [] } } },
    )).toEqual([{ project: "p", journey: "gone", state: "default" }, { project: "p", journey: "recipe", state: "dialog" }]);
  });

  it("treats a renamed journey as a drop and a new journey, refused until --remove names the old one", () => {
    const previous = census({ search: { default: one({ [SAVE]: 3 }) } });
    const actual = merged({ "search-no-results": { default: one({ [SAVE]: 1 }) } });
    expect(() => updateBaseline({ previous, actual })).toThrow(
      [
        "HX census: this run drops states the baseline has:",
        "  desktop-chrome / search / default",
        "  iphone-webkit / search / default",
        "If they are meant to go (a renamed journey or state is a drop plus a new one), name each with --remove <project/journey/state>, or a whole journey with --remove <journey>.",
      ].join("\n"),
    );
    const { baseline, removed } = updateBaseline({ previous, actual, remove: ["search"] });
    expect(baseline).toEqual(sortCensus(actual));
    expect(removed).toEqual([
      { project: "desktop-chrome", journey: "search", state: "default" },
      { project: "iphone-webkit", journey: "search", state: "default" },
    ]);
  });

  it("refuses a dropped state until --remove names it on every project, and a --remove that names nothing dropped", () => {
    const previous = census({ recipe: { default: one({ [SAVE]: 1 }), dialog: one({ [CLOSE]: 1 }) } });
    const actual = merged({ recipe: { default: one({ [SAVE]: 1 }) } });
    expect(() => updateBaseline({ previous, actual, remove: ["iphone-webkit/recipe/dialog"] })).toThrow(
      "HX census: this run drops states the baseline has:\n  desktop-chrome / recipe / dialog\n",
    );
    expect(
      updateBaseline({ previous, actual, remove: ["iphone-webkit/recipe/dialog", "desktop-chrome/recipe/dialog"] }).baseline,
    ).toEqual(sortCensus(actual));
    expect(() => updateBaseline({ previous, actual, remove: ["recipe", "home", "iphone-webkit/recipe/default"] })).toThrow(
      "HX census: --remove home names nothing this run drops.\nHX census: --remove iphone-webkit/recipe/default names nothing this run drops.",
    );
  });

  it("refuses an actual that records a project as {}, misses a project or a listed state, has no expected set, or has a bad shape", () => {
    const covered = merged({ home: { default: [] } });
    expect(() => updateBaseline({ previous: {}, actual: { ...covered, "iphone-webkit": {} } })).toThrow(
      "the run's actual census records nothing for project(s) iphone-webkit",
    );
    expect(() => updateBaseline({ previous: {}, actual: { $expected: { home: ["default"] }, "iphone-webkit": { home: { default: [] } } } })).toThrow(
      "missing project(s) desktop-chrome",
    );
    expect(() => updateBaseline({ previous: {}, actual: { ...covered, $expected: { home: ["default", "menu"] } } })).toThrow(
      [
        "HX census: the run's actual census does not cover the census list:",
        "  iphone-webkit / home / menu was not recorded",
        "  desktop-chrome / home / menu was not recorded",
      ].join("\n"),
    );
    expect(() => updateBaseline({ previous: {}, actual: census({ home: { default: [] } }) })).toThrow(
      "the run's actual census has no $expected set: use the merged hx-census-actual.json a Journeys run uploads.",
    );
    expect(() => updateBaseline({ previous: {}, actual: { ...covered, $expected: {} } })).toThrow("the run's actual census's $expected: the expected set");
    expect(() => updateBaseline({ previous: [] as never, actual: covered })).toThrow("the current baseline: a census file");
    expect(() => updateBaseline({ previous: {}, actual: covered, projects: ["x"] })).toThrow("missing project(s) x");
  });

  it("summarizes new, dropped and changed states", () => {
    const previous = { p: { home: { default: one({ [SAVE]: 1 }), gone: [], same: one({ [CLOSE]: 1 }) } } };
    const next = { $allowedRegressions: [], p: { home: { default: one({ [SAVE]: 2 }), same: one({ [CLOSE]: 1 }), fresh: [] } } };
    expect(summarizeChanges(previous, next)).toEqual([
      "  changed    p / home / default",
      `    count      ${SAVE} ×1 → ×2`,
      "  new state  p / home / fresh",
      "  dropped    p / home / gone",
    ]);
  });
});

describe("pnpm census:update", () => {
  const actual = merged({ home: { default: [{ identity: SAVE, count: 1 }] } });

  function files(entries: Record<string, unknown>) {
    const written: Record<string, string> = {};
    return {
      written,
      readFile: vi.fn((file: string) => {
        if (!(file in entries)) throw new Error(`ENOENT: ${file}`);
        return JSON.stringify(entries[file]);
      }),
      writeFile: vi.fn((file: string, text: string) => {
        written[file] = text;
      }),
      exists: vi.fn((file: string) => file in entries),
    };
  }

  it("parses its arguments", () => {
    expect(update.parseUpdateArgs(["123"])).toEqual({ source: "123", allowRegression: undefined, remove: [], baseline: BASELINE_PATH });
    expect(update.parseUpdateArgs(["--allow-regression", "why", "a.json", "--remove", "search", "--baseline", "b.json", "--remove", "iphone-webkit/home/menu"])).toEqual({
      source: "a.json",
      allowRegression: "why",
      remove: ["search", "iphone-webkit/home/menu"],
      baseline: "b.json",
    });
    expect(() => update.parseUpdateArgs(["1", "--remove"])).toThrow("--remove needs a value.");
    expect(() => update.parseUpdateArgs(["1", "--remove", "home/menu"])).toThrow("--remove takes <journey> or <project/journey/state>, not home/menu.");
    expect(() => update.parseUpdateArgs(["1", "--remove", "iphone-webkit//menu"])).toThrow("--remove takes <journey> or <project/journey/state>, not iphone-webkit//menu.");
    expect(() => update.parseUpdateArgs([])).toThrow("Usage: pnpm census:update");
    expect(() => update.parseUpdateArgs(["1", "--allow-regression"])).toThrow("--allow-regression needs a value.");
    expect(() => update.parseUpdateArgs(["1", "--baseline", "--x"])).toThrow("--baseline needs a value.");
    expect(() => update.parseUpdateArgs(["1", "--allow-regression", " "])).toThrow("--allow-regression needs a reason.");
    expect(() => update.parseUpdateArgs(["1", "--force"])).toThrow("Unknown option --force.");
    expect(() => update.parseUpdateArgs(["1", "2"])).toThrow("Unexpected argument 2.");
  });

  it("downloads a run's merged census with gh and rewrites the baseline", async () => {
    const downloaded = `.hx-census-download/42-7/${ACTUAL_FILE}`;
    const fs = files({ [downloaded]: actual });
    const run = vi.fn().mockResolvedValue(undefined);
    const mkdir = vi.fn();
    const out = io();
    const exit = vi.fn();
    await update.main(["42"], { ...fs, run, mkdir, now: () => 7, io: out, exit });
    expect(mkdir).toHaveBeenCalledWith(".hx-census-download/42-7");
    expect(run).toHaveBeenCalledWith("gh", ["run", "download", "42", "--name", "hx-census-actual", "--dir", ".hx-census-download/42-7"]);
    expect(fs.written[BASELINE_PATH]).toBe(stringifyCensus(sortCensus(actual)));
    expect(out.log).toHaveBeenCalledWith(`Wrote ${BASELINE_PATH} from ${downloaded}.`);
    expect(out.log).toHaveBeenCalledWith(expect.stringContaining("new state  desktop-chrome / home / default"));
    expect(out.log).toHaveBeenCalledWith("Unmarked controls per state:\n  desktop-chrome / home / default: 1\n  iphone-webkit / home / default: 1");
    expect(exit).not.toHaveBeenCalled();
  });

  it("reads a local file, even one named like a run id, and says when nothing changed", async () => {
    const fs = files({ "123": actual, [BASELINE_PATH]: sortCensus(actual) });
    const run = vi.fn();
    const out = io();
    await update.main(["123"], { ...fs, run, io: out, exit: vi.fn() });
    expect(run).not.toHaveBeenCalled();
    expect(out.log).toHaveBeenCalledWith("No changes.");
  });

  it("refuses a regression, writing nothing, and accepts it with a recorded reason", async () => {
    const previous = census({ home: { default: [] } });
    const fs = files({ "actual.json": actual, [BASELINE_PATH]: previous });
    const out = io();
    const exit = vi.fn();
    await update.main(["actual.json"], { ...fs, io: out, exit });
    expect(exit).toHaveBeenCalledWith(1);
    expect(out.error).toHaveBeenCalledWith(expect.stringContaining("desktop-chrome / home / default: 0 → 1 unmarked"));
    expect(fs.writeFile).not.toHaveBeenCalled();

    const accepted = io();
    await update.main(["actual.json", "--allow-regression", "measuring a new row"], { ...fs, io: accepted, exit: vi.fn() });
    expect(JSON.parse(fs.written[BASELINE_PATH]).$allowedRegressions[0]).toEqual({
      project: "desktop-chrome",
      journey: "home",
      state: "default",
      from: 0,
      to: 1,
      reason: "measuring a new row",
    });
    expect(accepted.log).toHaveBeenCalledWith("Allowed regression (measuring a new row): iphone-webkit / home / default 0 → 1 unmarked.");
  });

  it("refuses to drop a baselined journey, writing nothing, and drops it when --remove names it", async () => {
    const previous = census({ search: { default: [{ identity: SAVE, count: 1 }] } });
    const fs = files({ "actual.json": actual, [BASELINE_PATH]: previous });
    const out = io();
    const exit = vi.fn();
    await update.main(["actual.json"], { ...fs, io: out, exit });
    expect(exit).toHaveBeenCalledWith(1);
    expect(out.error).toHaveBeenCalledWith(expect.stringContaining("HX census: this run drops states the baseline has:\n  desktop-chrome / search / default"));
    expect(fs.writeFile).not.toHaveBeenCalled();

    const removed = io();
    await update.main(["actual.json", "--remove", "search"], { ...fs, io: removed, exit: vi.fn() });
    expect(fs.written[BASELINE_PATH]).toBe(stringifyCensus(sortCensus(actual)));
    expect(removed.log).toHaveBeenCalledWith("Removed (--remove): desktop-chrome / search / default.");
    expect(removed.log).toHaveBeenCalledWith("Removed (--remove): iphone-webkit / search / default.");
  });

  it("reports a non-Error failure", async () => {
    const out = io();
    const exit = vi.fn();
    await update.main(["a.json"], {
      readFile: () => {
        throw "unreadable";
      },
      io: out,
      exit,
    });
    expect(out.error).toHaveBeenCalledWith("unreadable");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("reads, writes, lists and runs with real files and processes by default", async () => {
    const directory = join(update.DOWNLOAD_DIRECTORY, `io-test-${process.pid}-${Date.now()}`);
    const file = join(directory, "census.json");
    try {
      update.makeDirectory(directory);
      update.writeText(file, "{}\n");
      expect(update.readText(file)).toBe("{}\n");
      expect(update.listDirectory(directory)).toEqual(["census.json"]);
      expect(update.listDirectory(join(directory, "missing"))).toEqual([]);
      expect(() => update.listDirectory(file)).toThrow(/ENOTDIR/);
      await expect(update.runCommand(process.execPath, ["-e", ""])).resolves.toBeUndefined();
      await expect(update.runCommand(process.execPath, ["-e", "process.exit(3)"])).rejects.toThrow(/Command failed/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    expect(existsSync(directory)).toBe(false);
  });

  it("sets the exit code and prints to the console by default", async () => {
    expectConsoleError(
      'Usage: pnpm census:update <run-id | path to hx-census-actual.json> [--allow-regression "<reason>"] [--remove <journey | project/journey/state>]... [--baseline <path>]',
    );
    const originalArgv = process.argv;
    process.argv = ["node", "hx-census-update.mjs"];
    try {
      await update.main();
      expect(process.exitCode).toBe(1);
    } finally {
      process.argv = originalArgv;
      process.exitCode = 0;
    }
  });

  it("runs only as the entry script", async () => {
    const url = pathToFileURL("/repo/scripts/hx-census-update.mjs").href;
    expect(update.isCliEntry(url, "/repo/scripts/hx-census-update.mjs")).toBe(true);
    expect(update.isCliEntry(url, undefined)).toBe(false);
    const runMain = vi.fn().mockResolvedValue(undefined);
    expect(update.runCliIfEntry({ moduleUrl: url, argv1: "/repo/scripts/hx-census-update.mjs", runMain })).toBe(true);
    expect(runMain).toHaveBeenCalledWith(process.argv.slice(2));
    expect(update.runCliIfEntry({ moduleUrl: url, argv1: "/elsewhere.mjs", runMain })).toBe(false);
    expect(update.runCliIfEntry()).toBe(false);
  });
});

describe("hx-census-merge", () => {
  const phone = { "iphone-webkit": { home: { default: [{ identity: SAVE, count: 1 }] } } };
  const desktop = { "desktop-chrome": { home: { default: [{ identity: SAVE, count: 1 }] } } };

  it("parses its arguments", () => {
    expect(merge.parseMergeArgs(["d", "o.json"])).toEqual({ directory: "d", output: "o.json", projects: CENSUS_PROJECTS });
    expect(merge.parseMergeArgs(["--project", "x", "d", "o.json", "--project", "y"])).toEqual({ directory: "d", output: "o.json", projects: ["x", "y"] });
    expect(() => merge.parseMergeArgs(["d"])).toThrow("Usage: node scripts/hx-census-merge.mjs");
    expect(() => merge.parseMergeArgs(["d", "o", "--project"])).toThrow("--project needs a value.");
    expect(() => merge.parseMergeArgs(["d", "o", "--project", "--x"])).toThrow("--project needs a value.");
    expect(() => merge.parseMergeArgs(["d", "o", "--all"])).toThrow("Unknown option --all.");
  });

  const expected = { home: ["default"] };

  it("merges the worker files, ignoring every other file, and writes the merged census with its expected set", () => {
    const contents: Record<string, unknown> = {
      "hx-census/hx-census-actual.iphone-webkit.0.json": phone,
      "hx-census/hx-census-actual.desktop-chrome.1.json": desktop,
      [`hx-census/${EXPECTED_FILE}`]: expected,
    };
    const writeFile = vi.fn();
    const out = io();
    const exit = vi.fn();
    merge.main(["hx-census", "hx-census-actual.json"], {
      readdir: () => ["notes.txt", EXPECTED_FILE, `${EXPECTED_FILE}.12.0.partial`, "hx-census-actual.desktop-chrome.1.json", "hx-census-actual.iphone-webkit.0.json"],
      readFile: (file) => JSON.stringify(contents[file]),
      writeFile,
      io: out,
      exit,
    });
    expect(writeFile).toHaveBeenCalledWith("hx-census-actual.json", stringifyCensus({ $expected: expected, ...desktop, ...phone }));
    expect(out.log).toHaveBeenCalledWith("Merged 2 census file(s) from hx-census into hx-census-actual.json.");
    expect(exit).not.toHaveBeenCalled();
  });

  it("fails, writing nothing, on a duplicate state, a missing project or a file that is not JSON", () => {
    const writeFile = vi.fn();
    const out = io();
    const exit = vi.fn();
    merge.main(["d", "o.json"], {
      readdir: () => ["hx-census-actual.iphone-webkit.0.json", "hx-census-actual.iphone-webkit.1.json"],
      readFile: (file) => JSON.stringify(file.endsWith(EXPECTED_FILE) ? expected : phone),
      writeFile,
      io: out,
      exit,
    });
    expect(out.error).toHaveBeenCalledWith(
      "HX census merge failed:\n  iphone-webkit / home / default is recorded twice (d/hx-census-actual.iphone-webkit.0.json and d/hx-census-actual.iphone-webkit.1.json)\n  no census recorded for project(s) desktop-chrome",
    );
    expect(exit).toHaveBeenCalledWith(1);

    const broken = io();
    merge.main(["d", "o.json"], {
      readdir: () => ["hx-census-actual.iphone-webkit.0.json"],
      readFile: (file) => (file.endsWith(EXPECTED_FILE) ? JSON.stringify(expected) : "{"),
      writeFile,
      io: broken,
      exit,
    });
    expect(broken.error).toHaveBeenCalledWith(expect.stringMatching(/^d\/hx-census-actual\.iphone-webkit\.0\.json is not JSON: /));

    const thrown = io();
    merge.main(["d", "o.json"], {
      readdir: () => ["hx-census-actual.iphone-webkit.0.json"],
      readFile: (file) => {
        if (file.endsWith(EXPECTED_FILE)) return JSON.stringify(expected);
        throw "gone";
      },
      writeFile,
      io: thrown,
      exit,
    });
    expect(thrown.error).toHaveBeenCalledWith("d/hx-census-actual.iphone-webkit.0.json is not JSON: gone");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("fails, writing nothing, without a valid expected set or when a listed state went unrecorded", () => {
    const writeFile = vi.fn();
    const exit = vi.fn();
    const readdir = () => ["hx-census-actual.iphone-webkit.0.json", "hx-census-actual.desktop-chrome.0.json"];
    const census = (expectedText: string | Error | string[]) => (file: string) => {
      if (!file.endsWith(EXPECTED_FILE)) return JSON.stringify(file.includes("iphone") ? phone : desktop);
      if (expectedText instanceof Error) throw expectedText;
      if (Array.isArray(expectedText)) throw expectedText[0];
      return expectedText;
    };

    const missing = io();
    merge.main(["d", "o.json"], { readdir, readFile: census(new Error("ENOENT: no such file")), writeFile, io: missing, exit });
    expect(missing.error).toHaveBeenCalledWith(
      `HX census merge failed: d/${EXPECTED_FILE} could not be read (ENOENT: no such file): the census journey writes it when it starts, so the census did not run.`,
    );

    const thrown = io();
    merge.main(["d", "o.json"], { readdir, readFile: census(["EACCES"]), writeFile, io: thrown, exit });
    expect(thrown.error).toHaveBeenCalledWith(expect.stringContaining("could not be read (EACCES)"));

    const notJson = io();
    merge.main(["d", "o.json"], { readdir, readFile: census("{"), writeFile, io: notJson, exit });
    expect(notJson.error).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^d/${EXPECTED_FILE.replace(/\./g, "\\.")} is not JSON: `)));

    const invalid = io();
    merge.main(["d", "o.json"], { readdir, readFile: census("{}"), writeFile, io: invalid, exit });
    expect(invalid.error).toHaveBeenCalledWith(`d/${EXPECTED_FILE}: the expected set is a non-empty JSON object of journeys, each listing its states.`);

    const uncovered = io();
    merge.main(["d", "o.json"], { readdir, readFile: census(JSON.stringify({ home: ["default", "menu"] })), writeFile, io: uncovered, exit });
    expect(uncovered.error).toHaveBeenCalledWith(
      "HX census merge failed:\n  iphone-webkit / home / menu was not recorded\n  desktop-chrome / home / menu was not recorded",
    );
    expect(writeFile).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledTimes(5);
  });

  it("treats a missing directory as no census, and uses the console and exit code by default", () => {
    const directory = join(update.DOWNLOAD_DIRECTORY, "no-such-directory");
    const expectedFile = join(directory, EXPECTED_FILE);
    expectConsoleError(
      `HX census merge failed: ${expectedFile} could not be read (ENOENT: no such file or directory, open '${expectedFile}'): the census journey writes it when it starts, so the census did not run.`,
    );
    merge.main([directory, "o.json"]);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("reports a directory it cannot list, and its usage when run without arguments", () => {
    const out = io();
    merge.main(["package.json", "o.json"], { io: out, exit: vi.fn() });
    expect(out.error).toHaveBeenCalledWith(expect.stringContaining("ENOTDIR"));

    const thrown = io();
    merge.main(["d", "o.json"], {
      readdir: () => {
        throw "EACCES";
      },
      readFile: () => JSON.stringify(expected),
      io: thrown,
      exit: vi.fn(),
    });
    expect(thrown.error).toHaveBeenCalledWith("EACCES");

    const originalArgv = process.argv;
    process.argv = ["node", "hx-census-merge.mjs"];
    expectConsoleError("Usage: node scripts/hx-census-merge.mjs <directory> <output> [--project <name>]...");
    try {
      merge.main();
      expect(process.exitCode).toBe(1);
    } finally {
      process.argv = originalArgv;
      process.exitCode = 0;
    }
  });

  it("runs only as the entry script", () => {
    const url = pathToFileURL("/repo/scripts/hx-census-merge.mjs").href;
    expect(merge.isCliEntry(url, "/repo/scripts/hx-census-merge.mjs")).toBe(true);
    expect(merge.isCliEntry(url, undefined)).toBe(false);
    const runMain = vi.fn();
    expect(merge.runCliIfEntry({ moduleUrl: url, argv1: "/repo/scripts/hx-census-merge.mjs", runMain })).toBe(true);
    expect(runMain).toHaveBeenCalledWith(process.argv.slice(2));
    expect(merge.runCliIfEntry({ moduleUrl: url, argv1: "/elsewhere.mjs", runMain })).toBe(false);
    expect(merge.runCliIfEntry()).toBe(false);
  });
});
