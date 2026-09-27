import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  checkJourneySource,
  defaultCliErrorHandler,
  isCliEntry,
  journeyFileKind,
  main,
  runCliIfEntry,
} from "../../scripts/check-journey-rules.mjs";
import { expectConsoleError } from "../warning-policy";

const rules = (src: string) => checkJourneySource("x.journey.ts", src).map((v: { rule: string }) => v.rule);
const supportRules = (src: string) =>
  checkJourneySource("support/helper.ts", src, { kind: "support" }).map((v: { rule: string }) => v.rule);

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

    it("flags a shorthand retries property assignment", () => {
      expect(rules(`const retries = 2; test.describe.configure({ retries });`)).toEqual(["no-retry-config"]);
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

    it("flags clicks inside an Array.forEach callback (finding 2 regression)", () => {
      expect(rules(`rows.forEach(async (row) => { await row.click(); });`)).toEqual(["no-click-in-loop"]);
    });

    it("flags clicks inside an Array.map callback", () => {
      expect(rules(`items.map(async (item) => { await item.click(); return item; });`)).toEqual([
        "no-click-in-loop",
      ]);
    });

    it("allows a click inside a non-iteration callback like .then(...)", () => {
      expect(rules(`promise.then(async () => { await btn.click(); });`)).toEqual([]);
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

    it("flags a @mutates title on test.only for a missing reload check (finding 1 regression)", () => {
      // test.only is also a no-skipped-journeys violation in its own right (rule 5) — both
      // fire together, which is the point: skipping/only-ing a test must not let it dodge the
      // reload-check requirement too.
      expect(
        rules(`test.only("adds item @mutates", async ({ page }) => { await page.click("a"); });`),
      ).toEqual(["no-skipped-journeys", "mutation-needs-reload-check"]);
    });

    it("flags a @mutates title on test.skip for a missing reload check (finding 1 regression)", () => {
      expect(
        rules(`test.skip("adds item @mutates", async ({ page }) => { await page.click("a"); });`),
      ).toEqual(["no-skipped-journeys", "mutation-needs-reload-check"]);
    });

    it("flags a @mutates title on test.fixme for a missing reload check (finding 1 regression)", () => {
      expect(
        rules(`test.fixme("adds item @mutates", async ({ page }) => { await page.click("a"); });`),
      ).toEqual(["no-skipped-journeys", "mutation-needs-reload-check"]);
    });

    it("allows test.only with @mutates once it calls verifyAfterReload", () => {
      expect(
        rules(
          `test.only("adds item @mutates", async ({ page, verifyAfterReload }) => { await verifyAfterReload(async () => {}); });`,
        ),
        // no-skipped-journeys still fires for test.only itself; mutation-needs-reload-check does not.
      ).toEqual(["no-skipped-journeys"]);
    });

    it("flags a @mutates tag inside an interpolated template-literal title (finding 3 regression)", () => {
      expect(
        rules("test(`adds ${item} @mutates`, async ({ page }) => { await page.click('a'); });"),
      ).toEqual(["mutation-needs-reload-check"]);
    });

    it("allows an interpolated template-literal @mutates title that calls verifyAfterReload", () => {
      expect(
        rules(
          "test(`adds ${item} @mutates`, async ({ page, verifyAfterReload }) => { await verifyAfterReload(async () => {}); });",
        ),
      ).toEqual([]);
    });

    it("ignores an interpolated template-literal title with no @mutates tag anywhere in its static text", () => {
      expect(rules("test(`adds ${item}`, async ({ page }) => { await page.click('a'); });")).toEqual([]);
    });

    it("finds the test body across Playwright's 3-argument test(title, options, body) form (finding 4 regression)", () => {
      expect(
        rules(
          `test("adds item @mutates", { tag: "@smoke" }, async ({ page, verifyAfterReload }) => { await verifyAfterReload(async () => {}); });`,
        ),
      ).toEqual([]);
    });

    it("still flags the 3-argument form when the body has no reload check", () => {
      expect(
        rules(`test("adds item @mutates", { tag: "@smoke" }, async ({ page }) => { await page.click("a"); });`),
      ).toEqual(["mutation-needs-reload-check"]);
    });
  });

  describe("no-skipped-journeys", () => {
    it("flags test.skip", () => {
      expect(rules(`test.skip("some test", async () => {});`)).toEqual(["no-skipped-journeys"]);
    });

    it("flags test.fixme", () => {
      expect(rules(`test.fixme("some test", async () => {});`)).toEqual(["no-skipped-journeys"]);
    });

    it("flags test.only", () => {
      expect(rules(`test.only("some test", async () => {});`)).toEqual(["no-skipped-journeys"]);
    });

    it("flags test.fail", () => {
      expect(rules(`test.fail("some test", async () => {});`)).toEqual(["no-skipped-journeys"]);
    });

    it("flags test.describe.skip", () => {
      expect(rules(`test.describe.skip("suite", () => { test("t", async () => {}); });`)).toEqual([
        "no-skipped-journeys",
      ]);
    });

    it("flags test.describe.only", () => {
      expect(rules(`test.describe.only("suite", () => { test("t", async () => {}); });`)).toEqual([
        "no-skipped-journeys",
      ]);
    });

    it("flags test.describe.fixme", () => {
      expect(rules(`test.describe.fixme("suite", () => { test("t", async () => {}); });`)).toEqual([
        "no-skipped-journeys",
      ]);
    });

    it("allows a plain test(...) call", () => {
      expect(rules(`test("some test", async () => {});`)).toEqual([]);
    });

    it("allows a plain test.describe(...) call", () => {
      expect(rules(`test.describe("suite", () => { test("t", async () => {}); });`)).toEqual([]);
    });

    it("does not flag an unrelated object's .skip(...)/.only(...) call", () => {
      // Regression guard: only `test.<modifier>` and `test.describe.<modifier>` should match,
      // not any arbitrary `.skip(...)` call on an unrelated object.
      expect(rules(`someOtherThing.skip("x");`)).toEqual([]);
    });

    it("does not flag test.step, which is not a skip/only/fixme/fail modifier", () => {
      expect(rules(`test.step("do a thing", async () => {});`)).toEqual([]);
    });
  });

  describe("no-secret-fill", () => {
    it("flags fill() into a field labelled Password, whatever is typed", () => {
      expect(rules(`await page.getByLabel("Password").fill(value);`)).toEqual(["no-secret-fill"]);
      expect(rules(`await page.getByLabel("Confirm Password", { exact: true }).fill(value);`)).toEqual(["no-secret-fill"]);
      expect(rules(`await section.getByRole("textbox", { name: /current password/i }).fill(value);`)).toEqual([
        "no-secret-fill",
      ]);
    });

    it("flags fill() into a password input selected by name or type", () => {
      expect(rules(`await page.locator('input[name="password"]:visible').fill(value);`)).toEqual(["no-secret-fill"]);
      expect(rules(`await page.locator("input[type=password]").fill(value);`)).toEqual(["no-secret-fill"]);
      expect(rules(`await page.locator('input[name="confirmPassword"]').fill(value);`)).toEqual(["no-secret-fill"]);
    });

    it("flags fill() of a value that names a password, secret, credential or token", () => {
      expect(rules(`await field.fill(user.password);`)).toEqual(["no-secret-fill"]);
      expect(rules(`await field.fill(newPassword);`)).toEqual(["no-secret-fill"]);
      expect(rules(`await field.fill(account.secret);`)).toEqual(["no-secret-fill"]);
      expect(rules(`await field.fill(credentials.value);`)).toEqual(["no-secret-fill"]);
      expect(rules(`await field.fill(apiToken);`)).toEqual(["no-secret-fill"]);
      expect(rules(`await field.fill("definitely-not-the-password");`)).toEqual(["no-secret-fill"]);
    });

    it("follows a local variable to the locator or value it was set to", () => {
      expect(rules(`const box = page.getByLabel("New Password"); await box.fill(value);`)).toEqual(["no-secret-fill"]);
      expect(rules(`const typed = persona("chef").password; await field.fill(typed);`)).toEqual(["no-secret-fill"]);
    });

    it("flags the other typing methods too", () => {
      expect(rules(`await page.getByLabel("Password").type(value);`)).toEqual(["no-secret-fill"]);
      expect(rules(`await field.pressSequentially(user.password);`)).toEqual(["no-secret-fill"]);
      expect(rules(`await page.keyboard.insertText(user.password);`)).toEqual(["no-secret-fill"]);
    });

    it("flags it in support helpers as well as journeys", () => {
      expect(supportRules(`export async function login(page, user) { await page.getByLabel("Password").fill(user.password); }`)).toEqual([
        "no-secret-fill",
      ]);
    });

    it("allows fillSecret and ordinary fills", () => {
      expect(rules(`await fillSecret(page.getByLabel("Password"), user.password);`)).toEqual([]);
      expect(rules(`await page.getByLabel("Username or email").fill(user.username);`)).toEqual([]);
      expect(rules(`const box = page.getByLabel("Search terms"); await box.fill("lemon");`)).toEqual([]);
      expect(rules(`await field.fill(typed);`)).toEqual([]);
      expect(rules(`await field.fill();`)).toEqual([]);
      expect(rules(`await fill(user.password);`)).toEqual([]);
    });
  });

  describe("setup and imported test aliases", () => {
    it("treats setup like test for skipped-journey calls", () => {
      expect(rules(`setup.skip("chef", async () => {});`)).toEqual(["no-skipped-journeys"]);
      expect(rules(`setup.only("chef", async () => {});`)).toEqual(["no-skipped-journeys"]);
      expect(rules(`setup.fixme("chef", async () => {});`)).toEqual(["no-skipped-journeys"]);
      expect(rules(`setup.describe.skip("personas", () => {});`)).toEqual(["no-skipped-journeys"]);
    });

    it("treats setup like test for the @mutates reload check", () => {
      expect(rules(`setup("seeds @mutates", async ({ page }) => { await page.click("a"); });`)).toEqual([
        "mutation-needs-reload-check",
      ]);
    });

    it("recognises an alias of test imported from @playwright/test", () => {
      expect(rules(`import { test as t } from "@playwright/test"; t.skip("x", async () => {});`)).toEqual([
        "no-skipped-journeys",
      ]);
    });

    it("recognises an alias of test imported from the journeys' support/journey module", () => {
      expect(
        rules(`import { expect, test as journey } from "./support/journey"; journey.describe.only("s", () => {});`),
      ).toEqual(["no-skipped-journeys"]);
      expect(
        rules(`import { test as j } from "../journey.ts"; j("adds @mutates", async ({ page }) => { await page.click("a"); });`),
      ).toEqual(["mutation-needs-reload-check"]);
      expect(rules(`import { test as j } from "./journey"; j.fail("x", async () => {});`)).toEqual([
        "no-skipped-journeys",
      ]);
    });

    it("still recognises a plain, un-aliased test import", () => {
      expect(rules(`import { test } from "./support/journey"; test.skip("x", async () => {});`)).toEqual([
        "no-skipped-journeys",
      ]);
    });

    it("ignores aliases from other modules, other imported names, and imports without named bindings", () => {
      expect(
        rules(
          [
            `import "./support/journey";`,
            `import pw from "@playwright/test";`,
            `import * as all from "@playwright/test";`,
            `import { test as vt } from "vitest";`,
            `import { expect as e } from "@playwright/test";`,
            `import { test as nj } from "./support/journeys";`,
            `const local = 1;`,
            `vt.skip("x"); e.skip("x"); nj.only("x"); pw.skip("x"); all.test.skip("x");`,
          ].join("\n"),
        ),
      ).toEqual([]);
    });
  });

  describe("support files", () => {
    it("flag clicks in loops, toPass callbacks and array-iteration callbacks", () => {
      expect(supportRules(`for (const a of rows) { await a.click(); }`)).toEqual(["no-click-in-loop"]);
      expect(supportRules(`await expect(async () => { await btn.click(); }).toPass();`)).toEqual(["no-click-in-loop"]);
      expect(supportRules(`rows.forEach(async (row) => { await row.fill("x"); });`)).toEqual(["no-click-in-loop"]);
    });

    it("flag retries configuration", () => {
      expect(supportRules(`export const options = { retries: 1 };`)).toEqual(["no-retry-config"]);
    });

    it("flag skipped calls and unchecked @mutates tests", () => {
      expect(supportRules(`test.skip("x", async () => {});`)).toEqual(["no-skipped-journeys"]);
      expect(supportRules(`test("adds @mutates", async ({ page }) => { await page.click("a"); });`)).toEqual([
        "mutation-needs-reload-check",
      ]);
    });

    it("allow a conditional assertion, which only journeys forbid", () => {
      expect(supportRules(`if (strict) { await expect(x).toBeVisible(); }`)).toEqual([]);
      expect(rules(`if (strict) { await expect(x).toBeVisible(); }`)).toEqual(["no-assertion-in-if"]);
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

describe("journeyFileKind", () => {
  it("classifies journeys, setup files and support helpers by path relative to the journeys directory", () => {
    expect(journeyFileKind("sign-in.journey.ts")).toBe("journey");
    expect(journeyFileKind("nested/personas.setup.ts")).toBe("journey");
    expect(journeyFileKind("support/journey.ts")).toBe("support");
    expect(journeyFileKind("support/nested/helper.ts")).toBe("support");
    expect(journeyFileKind(join("support", "sign-in.ts"))).toBe("support");
  });

  it("skips non-TypeScript support files and helpers outside support/", () => {
    expect(journeyFileKind("support/notes.md")).toBeUndefined();
    expect(journeyFileKind("helpers.ts")).toBeUndefined();
    expect(journeyFileKind("fixtures/support/x.ts")).toBeUndefined();
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

  it("checks support helpers as support files, so a conditional assertion there passes", async () => {
    const io = { log: vi.fn(), error: vi.fn() };
    const exit = vi.fn();
    const readdir = vi.fn().mockResolvedValue([fakeFile("e2e/journeys/support", "sign-in.ts")]);
    const readFile = vi.fn().mockResolvedValue(`if (strict) { await expect(x).toBeVisible(); }`);
    await main(["e2e/journeys"], { io, exit, readdir, readFile });
    expect(readFile).toHaveBeenCalledWith(join("e2e/journeys/support", "sign-in.ts"));
    expect(io.log).toHaveBeenCalledWith("Checked 1 journey file(s), 0 violation(s).");
    expect(exit).not.toHaveBeenCalled();
  });

  it("reports a click-in-loop violation inside a support helper", async () => {
    const io = { log: vi.fn(), error: vi.fn() };
    const exit = vi.fn();
    const readdir = vi.fn().mockResolvedValue([fakeFile("e2e/journeys/support", "rows.ts")]);
    const readFile = vi.fn().mockResolvedValue(`for (const r of rows) { await r.click(); }`);
    await main(["e2e/journeys"], { io, exit, readdir, readFile });
    expect(io.log).toHaveBeenCalledWith(expect.stringContaining("rows.ts:1 no-click-in-loop"));
    expect(exit).toHaveBeenCalledWith(1);
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
    const directory = "/definitely/does/not/exist/e2e-journeys-dir";
    expectConsoleError(
      `check-journey-rules: cannot read directory "${directory}": ENOENT: no such file or directory, scandir '${directory}'`,
    );
    await expect(main([directory], {})).resolves.toBeUndefined();
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("uses default argv and default deps when neither is passed at all", async () => {
    const originalArgv = process.argv;
    process.argv = ["node", "check-journey-rules.mjs"];
    expectConsoleError("Usage: check-journey-rules.mjs <directory>");
    try {
      await expect(main()).resolves.toBeUndefined();
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = 0;
      process.argv = originalArgv;
    }
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

  it("defaultCliErrorHandler logs an Error's message via the injected io and sets exitCode 1", () => {
    const io = { error: vi.fn() };
    defaultCliErrorHandler(new Error("boom"), io);
    expect(io.error).toHaveBeenCalledWith("boom");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("defaultCliErrorHandler stringifies a non-Error throw via the injected io", () => {
    const io = { error: vi.fn() };
    defaultCliErrorHandler("boom", io);
    expect(io.error).toHaveBeenCalledWith("boom");
    process.exitCode = 0;
  });

  it("defaultCliErrorHandler defaults to console when no io is injected", () => {
    expectConsoleError("boom-default");
    defaultCliErrorHandler(new Error("boom-default"));
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});
