// The HX census checks which parts of the shared shell each page shows, by landmark, not by control
// (e2e/journeys/support/census-shell.ts), so a new nav link changes no page's record.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkShell, SHELL_RECORD_DIR, visibleShellLandmarks, type ShellRecord } from "../e2e/journeys/support/census-shell-record";

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

describe("checkShell", () => {
  const record: ShellRecord = { "iphone-webkit": { default: ["footer"] } };
  const path = `${SHELL_RECORD_DIR}/recipe-edit.json`;

  it("passes a state that shows the landmarks its record names", () => {
    expect(checkShell(record, where, ["footer"])).toBeNull();
  });

  it("fails a page whose shell changed, naming the record to set", () => {
    expect(checkShell(record, where, ["tabBar", "footer"])).toEqual({
      kind: "changed",
      message: `This state shows the shell's ["tabBar","footer"], but ${path} expects ["footer"]. If the change is meant, set "iphone-webkit" › "default": ["tabBar","footer"].`,
    });
  });

  it("reports a state with no record without failing it, so a new census entry needs nothing else", () => {
    const unrecorded = { kind: "unrecorded", message: `${path} has no shell record for this state; to check it from now on, add "iphone-webkit" › "menu": [].` };
    expect(checkShell(record, { ...where, stateId: "menu" }, [])).toEqual(unrecorded);
    expect(checkShell(undefined, { ...where, stateId: "menu" }, [])?.kind).toBe("unrecorded");
  });
});

describe("the shell records", () => {
  it("name only states the census baseline has, one file per page journey", () => {
    const census = JSON.parse(readFileSync("e2e/ouro-census/census.baseline.json", "utf8")) as Record<string, Record<string, Record<string, unknown>>>;
    const files = readdirSync(SHELL_RECORD_DIR);
    expect(files.length).toBeGreaterThan(40);
    for (const file of files) {
      const journeyId = file.replace(/\.json$/, "");
      expect(journeyId.startsWith("shell-")).toBe(false);
      const record = JSON.parse(readFileSync(`${SHELL_RECORD_DIR}/${file}`, "utf8")) as ShellRecord;
      for (const [project, states] of Object.entries(record))
        expect(Object.keys(states).filter((stateId) => !census[project]?.[journeyId]?.[stateId]), `${file} › ${project}`).toEqual([]);
    }
  });
});
