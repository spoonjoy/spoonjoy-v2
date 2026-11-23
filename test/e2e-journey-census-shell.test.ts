// The HX census checks which parts of the shared shell each page shows, by landmark, not by control
// (e2e/journeys/support/census-shell.ts), so a new nav link changes no page's record.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SHELL_BASELINE_PATH, shellMismatch, visibleShellLandmarks, type ShellBaseline } from "../e2e/journeys/support/census-shell-record";

const where = { project: "iphone-webkit", journeyId: "recipe-edit", stateId: "default" };

describe("visibleShellLandmarks", () => {
  it("names the landmarks that show a control, in banner, nav, tab bar, footer order", () => {
    expect(visibleShellLandmarks([
      { identity: 'link "Roadmap" [link/root] in contentinfo', count: 1 },
      { identity: 'link "Kitchen" [tab-bar/tab] in navigation "Spoonjoy navigation"', count: 1 },
      { identity: 'button "Save" [button/root] in main', count: 1 },
    ])).toEqual(["tabBar", "footer"]);
    expect(visibleShellLandmarks([
      { identity: 'button "Log in" [button/root] in banner', count: 1 },
      { identity: 'link "Recipes" [link/root] in navigation "Main navigation"', count: 2 },
    ])).toEqual(["banner", "nav"]);
    expect(visibleShellLandmarks([])).toEqual([]);
  });

  it("reads a nav link the same as another, so adding one changes nothing", () => {
    const before = [{ identity: 'link "Kitchen" [tab-bar/tab] in navigation "Spoonjoy navigation"', count: 1 }];
    const after = [...before, { identity: 'link "Households" [tab-bar/tab] in navigation "Spoonjoy navigation"', count: 1 }];
    expect(visibleShellLandmarks(after)).toEqual(visibleShellLandmarks(before));
  });
});

describe("shellMismatch", () => {
  const baseline: ShellBaseline = { "iphone-webkit": { "recipe-edit": { default: ["footer"] } } };

  it("passes a state that shows the landmarks its record names", () => {
    expect(shellMismatch(baseline, where, ["footer"])).toBeNull();
  });

  it("fails a page whose shell changed, naming the record to set", () => {
    expect(shellMismatch(baseline, where, ["tabBar", "footer"])).toBe(
      `This state shows the shell's ["tabBar","footer"], but ${SHELL_BASELINE_PATH} expects ["footer"]. If the change is meant, set "iphone-webkit" › "recipe-edit" › "default": ["tabBar","footer"].`,
    );
  });

  it("fails a state with no record, naming the record to add", () => {
    expect(shellMismatch(baseline, { ...where, stateId: "menu" }, [])).toBe(
      `${SHELL_BASELINE_PATH} has no shell record for this state. If the page is new, add "iphone-webkit" › "recipe-edit" › "menu": [].`,
    );
  });
});

describe("the shell baseline", () => {
  it("records a state for each page state in the census baseline, apart from the shell's own", () => {
    const shell = JSON.parse(readFileSync(SHELL_BASELINE_PATH, "utf8")) as ShellBaseline;
    const census = JSON.parse(readFileSync("e2e/ouro-census/census.baseline.json", "utf8")) as Record<string, Record<string, Record<string, unknown>>>;
    for (const [project, journeys] of Object.entries(census)) {
      const pageStates = Object.entries(journeys)
        .filter(([journeyId]) => !journeyId.startsWith("shell-"))
        .flatMap(([journeyId, states]) => Object.keys(states).map((stateId) => `${journeyId}/${stateId}`))
        .sort();
      const recorded = Object.entries(shell[project] ?? {}).flatMap(([journeyId, states]) => Object.keys(states).map((stateId) => `${journeyId}/${stateId}`)).sort();
      expect(recorded).toEqual(pageStates);
    }
  });
});
