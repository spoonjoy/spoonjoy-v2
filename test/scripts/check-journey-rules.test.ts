import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  checkJourneySource,
  defaultCliErrorHandler,
  isCliEntry,
  main,
  runCliIfEntry,
} from "../../scripts/check-journey-rules.mjs";

const rules = (src: string) => checkJourneySource("x.journey.ts", src).map((v: { rule: string }) => v.rule);

describe("checkJourneySource", () => {
  describe("no-retry-config", () => {
    it("flags a retries property assignment", () => {
      expect(rules(`test.describe.configure({ retries: 2 });`)).toEqual(["no-retry-config"]);
    });

    it("allows a file with no retries property", () => {
      expect(rules(`test.describe.configure({ timeout: 2 });`)).toEqual([]);
    });

    it("flags a quoted retries property name", () => {
      expect(rules(`test.describe.configure({ "retries": 3 });`)).toEqual(["no-retry-config"]);
    });

    it("allows a computed property name (neither an identifier nor a string literal)", () => {
      expect(rules(`const key = "retries"; const cfg = { [key]: 2 };`)).toEqual([]);
    });
  });

  describe("no-click-in-loop", () => {
    it("flags clicks inside a for...of loop", () => {
      expect(rules(`for (const a of [1, 2]) { await page.getByRole("button").click(); }`)).toEqual([
        "no-click-in-loop",
      ]);
    });

    it("flags clicks inside a plain for loop", () => {
      expect(rules(`for (let i = 0; i < 3; i++) { await row.press("Enter"); }`)).toEqual(["no-click-in-loop"]);
    });

    it("flags clicks inside a while loop", () => {
      expect(rules(`while (more) { await field.fill("x"); }`)).toEqual(["no-click-in-loop"]);
    });

    it("flags clicks inside a do...while loop", () => {
      expect(rules(`do { await box.check(); } while (more);`)).toEqual(["no-click-in-loop"]);
    });

    it("flags clicks inside a .toPass() retry callback", () => {
      expect(rules(`await expect(async () => { await btn.click(); }).toPass();`)).toEqual(["no-click-in-loop"]);
    });

    it("flags dispatchEvent the same as click", () => {
      expect(rules(`for (const el of els) { await el.dispatchEvent("click"); }`)).toEqual(["no-click-in-loop"]);
    });

    it("allows reading inside loops", () => {
      expect(rules(`for (const r of rows) { await expect(r).toBeVisible(); }`)).toEqual([]);
    });

    it("allows clicks outside any loop or toPass callback", () => {
      expect(rules(`await page.getByRole("button").click();`)).toEqual([]);
    });

    it("allows a bare .toPass() callback with no click-like call inside", () => {
      expect(rules(`await expect(async () => { await expect(x).toBeVisible(); }).toPass();`)).toEqual([]);
    });

    it("allows a click inside a function expression that is not itself a call argument", () => {
      // Exercises the walk-past-unrelated-function guard: the function wrapping the click is
      // assigned to a variable and invoked separately, so it is never the argument of a
      // `.toPass()` call and must not be mistaken for one.
      expect(rules(`const helper = function () { btn.click(); }; helper();`)).toEqual([]);
    });
  });

  describe("no-assertion-in-if", () => {
    it("flags assertions inside an if's then branch", () => {
      expect(rules(`if (await x.isVisible()) { await expect(x).toHaveText("a"); }`)).toEqual([
        "no-assertion-in-if",
      ]);
    });

    it("flags assertions inside an if's else branch", () => {
      expect(rules(`if (cond) { doThing(); } else { await expect(x).toHaveText("a"); }`)).toEqual([
        "no-assertion-in-if",
      ]);
    });

    it("flags assertions inside a conditional expression's true branch", () => {
      expect(rules(`cond ? await expect(x).toHaveText("a") : null;`)).toEqual(["no-assertion-in-if"]);
    });

    it("flags assertions inside a conditional expression's false branch", () => {
      expect(rules(`cond ? null : await expect(x).toHaveText("a");`)).toEqual(["no-assertion-in-if"]);
    });

    it("allows an unconditional assertion", () => {
      expect(rules(`await expect(x).toHaveText("a");`)).toEqual([]);
    });

    it("allows a plain if with no assertion inside", () => {
      expect(rules(`if (await x.isVisible()) { await x.click(); }`)).toEqual([]);
    });
  });

  describe("mutation-needs-reload-check", () => {
    it("flags a @mutates test with no verifyAfterReload call", () => {
      expect(
        rules(`test("adds item @mutates", async ({ page }) => { await page.click("a"); });`),
      ).toEqual(["mutation-needs-reload-check"]);
    });

    it("allows a @mutates test that calls verifyAfterReload", () => {
      expect(
        rules(
          `test("adds item @mutates", async ({ page, verifyAfterReload }) => { await verifyAfterReload(async () => {}); });`,
        ),
      ).toEqual([]);
    });

    it("ignores tests without @mutates in the title", () => {
      expect(rules(`test("views item", async ({ page }) => { await page.click("a"); });`)).toEqual([]);
    });

    it("flags a @mutates test with no body argument at all", () => {
      expect(rules(`test("adds item @mutates");`)).toEqual(["mutation-needs-reload-check"]);
    });

    it("ignores a test(...) call whose title is not a string literal", () => {
      expect(rules(`const title = getTitle(); test(title, async () => { await page.click("a"); });`)).toEqual([]);
    });

    it("allows a verifyAfterReload call followed by more statements in the same test body", () => {
      // Exercises the "found, stop descending" short-circuit in the body walk: the reload
      // check must still be recognized even when it is not the last statement.
      expect(
        rules(
          `test("adds item @mutates", async ({ page, verifyAfterReload }) => { await verifyAfterReload(async () => {}); await page.click("a"); });`,
        ),
      ).toEqual([]);
    });
  });

  it("reports line numbers relative to the source", () => {
    const [v] = checkJourneySource("x.journey.ts", `\n\ntest.describe.configure({ retries: 1 });`);
    expect(v.line).toBe(3);
    expect(v.file).toBe("x.journey.ts");
  });

  it("returns no violations for an empty file", () => {
    expect(checkJourneySource("x.journey.ts", "")).toEqual([]);
  });

  it("populates a human-readable message on every violation", () => {
    const violations = checkJourneySource(
      "x.journey.ts",
      `test.describe.configure({ retries: 2 });`,
    );
    expect(violations).toHaveLength(1);
    expect(typeof violations[0].message).toBe("string");
    expect(violations[0].message.length).toBeGreaterThan(0);
  });
});

function fakeFile(parentPath: string, name: string) {
  return { name, parentPath, isFile: () => true };
}

function fakeDir(parentPath: string, name: string) {
  return { name, parentPath, isFile: () => false };
}

describe("main", () => {
  it("prints usage and exits 1 when the directory argument is missing", async () => {
    const io = { log: vi.fn(), error: vi.fn() };
    const exit = vi.fn();
    await main([], { io, exit, readdir: vi.fn(), readFile: vi.fn() });
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining("Usage"));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("errors and exits 1 when the directory cannot be read", async () => {
    const io = { log: vi.fn(), error: vi.fn() };
    const exit = vi.fn();
    const readdir = vi.fn().mockRejectedValue(new Error("ENOENT: no such file or directory"));
    await main(["e2e/journeys"], { io, exit, readdir, readFile: vi.fn() });
    expect(readdir).toHaveBeenCalledWith("e2e/journeys");
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining("e2e/journeys"));
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining("ENOENT"));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("reports zero files checked and does not exit 1 when the directory has no journey files", async () => {
    const io = { log: vi.fn(), error: vi.fn() };
    const exit = vi.fn();
    const readdir = vi.fn().mockResolvedValue([]);
    await main(["e2e/journeys"], { io, exit, readdir, readFile: vi.fn() });
    expect(io.log).toHaveBeenCalledWith(expect.stringContaining("Checked 0 journey file(s)"));
    expect(exit).not.toHaveBeenCalledWith(1);
  });

  it("filters to only *.journey.ts and *.setup.ts files, skipping others and directories", async () => {
    const io = { log: vi.fn(), error: vi.fn() };
    const exit = vi.fn();
    const readdir = vi.fn().mockResolvedValue([
      fakeFile("e2e/journeys", "sign-in.journey.ts"),
      fakeFile("e2e/journeys", "personas.setup.ts"),
      fakeFile("e2e/journeys", "notes.md"),
      fakeFile("e2e/journeys", "helpers.ts"),
      fakeDir("e2e/journeys", "fixtures"),
    ]);
    const readFile = vi.fn().mockResolvedValue("test('ok', async () => {});");
    await main(["e2e/journeys"], { io, exit, readdir, readFile });
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(readFile).toHaveBeenCalledWith(expect.stringContaining("sign-in.journey.ts"));
    expect(readFile).toHaveBeenCalledWith(expect.stringContaining("personas.setup.ts"));
    expect(io.log).toHaveBeenCalledWith(expect.stringContaining("Checked 2 journey file(s)"));
    expect(exit).not.toHaveBeenCalledWith(1);
  });

  it("prints each violation as file:line rule message and exits 1", async () => {
    const io = { log: vi.fn(), error: vi.fn() };
    const exit = vi.fn();
    const readdir = vi.fn().mockResolvedValue([fakeFile("e2e/journeys", "sign-in.journey.ts")]);
    const readFile = vi.fn().mockResolvedValue(`test.describe.configure({ retries: 1 });`);
    await main(["e2e/journeys"], { io, exit, readdir, readFile });
    const joinedPath = joinPath("e2e/journeys", "sign-in.journey.ts");
    expect(io.log).toHaveBeenCalledWith(
      `${joinedPath}:1 no-retry-config Journeys must not configure retries; fix the flaky step instead of hiding it.`,
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("uses default readdir/readFile/io/exit when no deps are injected", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(main(["/definitely/does/not/exist/e2e-journeys-dir"], {})).resolves.toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
    process.exitCode = 0;
    errorSpy.mockRestore();
  });

  it("uses default argv and default deps when neither is passed at all", async () => {
    const originalArgv = process.argv;
    process.argv = ["node", "check-journey-rules.mjs"];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(main()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Usage"));
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    process.argv = originalArgv;
    errorSpy.mockRestore();
  });

  it("formats a non-Error readdir rejection with String(error)", async () => {
    const io = { log: vi.fn(), error: vi.fn() };
    const exit = vi.fn();
    const readdir = vi.fn().mockRejectedValue("boom-string");
    await main(["e2e/journeys"], { io, exit, readdir, readFile: vi.fn() });
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining("boom-string"));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("falls back from entry.parentPath to entry.path to the scanned directory", async () => {
    const io = { log: vi.fn(), error: vi.fn() };
    const exit = vi.fn();
    const readdir = vi.fn().mockResolvedValue([
      { name: "a.journey.ts", path: "e2e/journeys/nested", isFile: () => true },
      { name: "b.journey.ts", isFile: () => true },
    ]);
    const readFile = vi.fn().mockResolvedValue("");
    await main(["e2e/journeys"], { io, exit, readdir, readFile });
    expect(readFile).toHaveBeenCalledWith(expect.stringContaining("nested"));
    expect(readFile).toHaveBeenCalledWith(expect.stringContaining("e2e/journeys"));
  });

  it("scans a real directory and reads a real file via the default readdir/readFile", async () => {
    const dir = mkdtempSync(join(tmpdir(), "check-journey-rules-"));
    writeFileSync(join(dir, "sign-in.journey.ts"), `test.describe.configure({ retries: 1 });`);
    try {
      const io = { log: vi.fn(), error: vi.fn() };
      const exit = vi.fn();
      await main([dir], { io, exit });
      expect(io.log).toHaveBeenCalledWith(expect.stringContaining("no-retry-config"));
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function joinPath(...parts: string[]) {
  return parts.join("/");
}

describe("CLI entry guard", () => {
  it("isCliEntry is true only when argv1 resolves to this module", () => {
    expect(isCliEntry("file:///a/b.mjs", "/a/b.mjs")).toBe(true);
    expect(isCliEntry("file:///a/b.mjs", "/a/other.mjs")).toBe(false);
    expect(isCliEntry("file:///a/b.mjs", undefined)).toBe(false);
  });

  it("runCliIfEntry does nothing when this module is not the entry point", () => {
    const runMain = vi.fn();
    const result = runCliIfEntry({ moduleUrl: "file:///a/b.mjs", argv1: "/a/other.mjs", runMain });
    expect(result).toBe(false);
    expect(runMain).not.toHaveBeenCalled();
  });

  it("runCliIfEntry runs main and returns true when this module is the entry point", async () => {
    const runMain = vi.fn().mockResolvedValue(undefined);
    const result = runCliIfEntry({ moduleUrl: "file:///a/b.mjs", argv1: "/a/b.mjs", runMain });
    expect(result).toBe(true);
    await Promise.resolve();
    expect(runMain).toHaveBeenCalled();
  });

  it("runCliIfEntry routes a rejected main() to onError", async () => {
    const failure = new Error("boom");
    const runMain = vi.fn().mockRejectedValue(failure);
    const onError = vi.fn();
    runCliIfEntry({ moduleUrl: "file:///a/b.mjs", argv1: "/a/b.mjs", runMain, onError });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("defaultCliErrorHandler logs an Error's message and sets exitCode 1", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    defaultCliErrorHandler(new Error("boom"));
    expect(errorSpy).toHaveBeenCalledWith("boom");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    errorSpy.mockRestore();
  });

  it("defaultCliErrorHandler stringifies a non-Error throw", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    defaultCliErrorHandler("boom");
    expect(errorSpy).toHaveBeenCalledWith("boom");
    process.exitCode = 0;
    errorSpy.mockRestore();
  });
});
