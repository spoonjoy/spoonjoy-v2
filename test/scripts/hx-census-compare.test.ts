import { describe, expect, it, vi } from "vitest";
import { pathToFileURL } from "node:url";
import { ACTUAL_FILE, CENSUS_PROJECTS, compareCensuses } from "../../scripts/hx-census.mjs";
import * as compare from "../../scripts/hx-census-compare.mjs";
import { expectConsoleError } from "../warning-policy";

const SAVE = 'button "Save" [-/-] in main';
const CLOSE = 'button "Close" [-/-] in dialog "Save to cookbook"';

function census(journeys: Record<string, Record<string, Array<{ identity: string; count: number }>>>) {
  return Object.fromEntries(CENSUS_PROJECTS.map((project) => [project, journeys]));
}

function io() {
  return { log: vi.fn(), error: vi.fn() };
}

describe("compareCensuses", () => {
  it("finds nothing between two runs that recorded the same census", () => {
    const run = census({ home: { default: [{ identity: SAVE, count: 1 }] } });
    expect(compareCensuses({ $expected: { home: ["default"] }, ...run }, structuredClone(run), { a: "1", b: "2" })).toEqual([]);
  });

  it("names every state only one run recorded and every identity that differs", () => {
    const a = census({ home: { default: [{ identity: SAVE, count: 1 }], gone: [] } });
    const b = census({ home: { default: [{ identity: SAVE, count: 2 }, { identity: CLOSE, count: 1 }], fresh: [] } });
    expect(compareCensuses(a, b, { a: "1", b: "2" })).toEqual([
      "  differs    desktop-chrome / home / default (1 → 2)",
      `    added      ${CLOSE} ×1`,
      `    count      ${SAVE} ×1 → ×2`,
      "  only in 2: desktop-chrome / home / fresh",
      "  only in 1: desktop-chrome / home / gone",
      "  differs    iphone-webkit / home / default (1 → 2)",
      `    added      ${CLOSE} ×1`,
      `    count      ${SAVE} ×1 → ×2`,
      "  only in 2: iphone-webkit / home / fresh",
      "  only in 1: iphone-webkit / home / gone",
    ]);
  });
});

describe("pnpm census:compare", () => {
  const first = census({ home: { default: [{ identity: SAVE, count: 1 }] } });
  const second = census({ home: { default: [{ identity: CLOSE, count: 1 }] } });

  function files(entries: Record<string, unknown>) {
    return {
      readFile: vi.fn((file: string) => {
        if (!(file in entries)) throw new Error(`ENOENT: ${file}`);
        return JSON.stringify(entries[file]);
      }),
      exists: vi.fn((file: string) => file in entries),
    };
  }

  it("parses its arguments", () => {
    expect(compare.parseCompareArgs(["1", "b.json"])).toEqual({ a: "1", b: "b.json" });
    expect(() => compare.parseCompareArgs(["1"])).toThrow("Usage: pnpm census:compare");
    expect(() => compare.parseCompareArgs(["1", "2", "3"])).toThrow("Usage: pnpm census:compare");
    expect(() => compare.parseCompareArgs(["1", "--allow"])).toThrow("Unknown option --allow.");
  });

  it("downloads two runs' censuses and passes when they are identical", async () => {
    const fs = files({ [`.hx-census-download/41-7/${ACTUAL_FILE}`]: first, [`.hx-census-download/42-7/${ACTUAL_FILE}`]: first });
    const run = vi.fn().mockResolvedValue(undefined);
    const mkdir = vi.fn();
    const out = io();
    const exit = vi.fn();
    await compare.main(["41", "42"], { ...fs, run, mkdir, now: () => 7, io: out, exit });
    expect(run).toHaveBeenCalledWith("gh", ["run", "download", "41", "--name", "hx-census-actual", "--dir", ".hx-census-download/41-7"]);
    expect(run).toHaveBeenCalledWith("gh", ["run", "download", "42", "--name", "hx-census-actual", "--dir", ".hx-census-download/42-7"]);
    expect(out.log).toHaveBeenCalledWith("HX census: 41 and 42 recorded identical censuses.");
    expect(exit).not.toHaveBeenCalled();
  });

  it("fails, naming every difference, when two runs differ", async () => {
    const fs = files({ "a.json": first, "b.json": second });
    const out = io();
    const exit = vi.fn();
    await compare.main(["a.json", "b.json"], { ...fs, io: out, exit });
    expect(exit).toHaveBeenCalledWith(1);
    expect(out.error).toHaveBeenCalledWith(
      [
        "HX census: a.json and b.json recorded different censuses:",
        "  differs    desktop-chrome / home / default (a.json → b.json)",
        `    added      ${CLOSE} ×1`,
        `    removed    ${SAVE} ×1`,
        "  differs    iphone-webkit / home / default (a.json → b.json)",
        `    added      ${CLOSE} ×1`,
        `    removed    ${SAVE} ×1`,
      ].join("\n"),
    );
  });

  it("refuses a file that is not a census, and reports a non-Error failure", async () => {
    const out = io();
    const exit = vi.fn();
    await compare.main(["a.json", "b.json"], { ...files({ "a.json": [], "b.json": first }), io: out, exit });
    expect(out.error).toHaveBeenCalledWith("a.json: a census file is a JSON object of projects.");
    expect(exit).toHaveBeenCalledWith(1);

    const thrown = io();
    await compare.main(["a.json", "b.json"], {
      readFile: () => {
        throw "unreadable";
      },
      exists: () => true,
      io: thrown,
      exit: vi.fn(),
    });
    expect(thrown.error).toHaveBeenCalledWith("unreadable");
  });

  it("sets the exit code and prints to the console by default", async () => {
    expectConsoleError("Usage: pnpm census:compare <run-id | path> <run-id | path>");
    const originalArgv = process.argv;
    process.argv = ["node", "hx-census-compare.mjs"];
    try {
      await compare.main();
      expect(process.exitCode).toBe(1);
    } finally {
      process.argv = originalArgv;
      process.exitCode = 0;
    }
  });

  it("runs only as the entry script", () => {
    const url = pathToFileURL("/repo/scripts/hx-census-compare.mjs").href;
    expect(compare.isCliEntry(url, "/repo/scripts/hx-census-compare.mjs")).toBe(true);
    expect(compare.isCliEntry(url, undefined)).toBe(false);
    const runMain = vi.fn().mockResolvedValue(undefined);
    expect(compare.runCliIfEntry({ moduleUrl: url, argv1: "/repo/scripts/hx-census-compare.mjs", runMain })).toBe(true);
    expect(runMain).toHaveBeenCalledWith(process.argv.slice(2));
    expect(compare.runCliIfEntry({ moduleUrl: url, argv1: "/elsewhere.mjs", runMain })).toBe(false);
    expect(compare.runCliIfEntry()).toBe(false);
  });
});
