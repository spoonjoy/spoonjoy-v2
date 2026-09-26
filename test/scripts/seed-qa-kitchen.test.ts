import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { describe, expect, it, vi } from "vitest";
import {
  KITCHEN,
  buildKitchenResetSql,
  defaultCliErrorHandler,
  generatePersonaPasswords,
  isCliEntry,
  main,
  parseSeedKitchenArgs,
  runCliIfEntry,
} from "../../scripts/seed-qa-kitchen.mjs";

const MIGRATIONS = resolve(__dirname, "../../migrations");
function migratedDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(resolve(MIGRATIONS, file), "utf8"));
  }
  return db;
}
const fastHash = (p: string) => bcrypt.hashSync(p, 4);
const passwords = { chef: "chef-pw", friend: "friend-pw", newbie: "newbie-pw" };

describe("seed-qa-kitchen", () => {
  it("builds the kitchen on a database created from the real migrations", () => {
    const db = migratedDb();
    db.exec(buildKitchenResetSql({ passwords, hash: fastHash }));
    const chef = db.prepare('SELECT username, email, hashedPassword FROM "User" WHERE id = ?').get(KITCHEN.chef.id) as any;
    expect(chef.username).toBe("qa_kitchen_chef");
    expect(bcrypt.compareSync("chef-pw", chef.hashedPassword)).toBe(true);
    expect(db.prepare("SELECT COUNT(*) n FROM Recipe WHERE chefId = ?").get(KITCHEN.chef.id)).toEqual({ n: 2 });
    expect(db.prepare("SELECT COUNT(*) n FROM Recipe WHERE chefId = ?").get(KITCHEN.friend.id)).toEqual({ n: 2 });
    expect(db.prepare("SELECT COUNT(*) n FROM StepOutputUse WHERE recipeId = ?").get(KITCHEN.recipes.lemonRice.id)).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) n FROM RecipeInCookbook WHERE cookbookId = ?").get(KITCHEN.cookbooks.weeknight.id)).toEqual({ n: 2 });
    expect(db.prepare("SELECT COUNT(*) n FROM ShoppingListItem i JOIN ShoppingList l ON l.id = i.shoppingListId WHERE l.authorId = ? AND i.checked = 0").get(KITCHEN.chef.id)).toEqual({ n: 3 });
    expect(db.prepare("SELECT COUNT(*) n FROM RecipeSpoon WHERE chefId = ?").get(KITCHEN.chef.id)).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) n FROM Recipe WHERE chefId = ?").get(KITCHEN.newbie.id)).toEqual({ n: 0 });
  });

  it("is idempotent and resets drift, including forks and cookbook entries made by other users", () => {
    const db = migratedDb();
    db.exec(buildKitchenResetSql({ passwords, hash: fastHash }));
    db.exec(`INSERT INTO "User" (id, email, username, createdAt, updatedAt) VALUES ('codex-e2e-x', 'codex-e2e-x@example.com', 'codex_e2e_x', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`);
    db.exec(`INSERT INTO Recipe (id, title, chefId, sourceRecipeId, coverMode, createdAt, updatedAt) VALUES ('fork-1', 'Saffron Risotto', 'codex-e2e-x', '${KITCHEN.recipes.risotto.id}', 'auto', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`);
    db.exec(`INSERT INTO Cookbook (id, title, authorId, createdAt, updatedAt) VALUES ('cb-x', 'Mine', 'codex-e2e-x', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`);
    db.exec(`INSERT INTO RecipeInCookbook (id, cookbookId, recipeId, addedById, createdAt, updatedAt) VALUES ('ric-x', 'cb-x', '${KITCHEN.recipes.salmon.id}', 'codex-e2e-x', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`);
    db.exec(`UPDATE ShoppingListItem SET checked = 1 WHERE shoppingListId IN (SELECT id FROM ShoppingList WHERE authorId = '${KITCHEN.chef.id}');`);
    expect(() => db.exec(buildKitchenResetSql({ passwords: { chef: "new", friend: "new", newbie: "new" }, hash: fastHash }))).not.toThrow();
    expect(db.prepare("SELECT sourceRecipeId FROM Recipe WHERE id = 'fork-1'").get()).toEqual({ sourceRecipeId: null });
    expect(db.prepare("SELECT COUNT(*) n FROM ShoppingListItem i JOIN ShoppingList l ON l.id = i.shoppingListId WHERE l.authorId = ? AND i.checked = 0").get(KITCHEN.chef.id)).toEqual({ n: 3 });
    const chef = db.prepare('SELECT hashedPassword FROM "User" WHERE id = ?').get(KITCHEN.chef.id) as any;
    expect(bcrypt.compareSync("new", chef.hashedPassword)).toBe(true);
  });

  it("reuses existing shared units and ingredient refs by name", () => {
    // Note: the historical seed migrations (0002_seed.sql / 0004_reseed.sql, still
    // active — 0024_remove_legacy_demo_identities.sql only purges User-linked rows,
    // never the shared Unit/IngredientRef tables) already insert a Unit named "cup",
    // so pre-inserting a second "cup" row here would violate Unit's UNIQUE(name)
    // constraint before buildKitchenResetSql even runs. "fillet" is a unit this
    // seed's own content introduces (for Miso Glazed Salmon) and that the historical
    // seed does not, so it exercises the same "someone else already created this
    // shared row under another id" scenario without colliding with fixture data.
    const db = migratedDb();
    db.exec(`INSERT INTO Unit (id, name, updatedAt) VALUES ('someone-else-fillet', 'fillet', CURRENT_TIMESTAMP);`);
    db.exec(buildKitchenResetSql({ passwords, hash: fastHash }));
    expect(db.prepare("SELECT COUNT(*) n FROM Unit WHERE name = 'fillet'").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT i.id AS id FROM Ingredient i JOIN Unit u ON u.id = i.unitId WHERE u.name = 'fillet'").get()).toEqual({
      id: `${KITCHEN.recipes.salmon.id}-ingredient-2-salmon`,
    });
  });

  it("generates distinct strong passwords per run", () => {
    const a = generatePersonaPasswords();
    const b = generatePersonaPasswords();
    expect(a.chef).not.toBe(b.chef);
    expect(a.chef).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("refuses any target but QA", () => {
    expect(() => parseSeedKitchenArgs([])).toThrow(/--target-env qa/);
    expect(() => parseSeedKitchenArgs(["--target-env", "production"])).toThrow(/--target-env qa/);
    expect(parseSeedKitchenArgs(["--target-env", "qa", "--credentials-out", "/tmp/c.json"])).toEqual({ targetEnv: "qa", dryRun: false, credentialsOut: "/tmp/c.json" });
  });

  it("defaults credentialsOut to null when --credentials-out is not given", () => {
    expect(parseSeedKitchenArgs(["--target-env", "qa"])).toEqual({ targetEnv: "qa", dryRun: false, credentialsOut: null });
  });

  describe("main", () => {
    it("writes the reset SQL to a temp file, runs wrangler, removes the temp file, and writes credentials", () => {
      const execFile = vi.fn();
      const writeFile = vi.fn();
      const rm = vi.fn();
      const mkdtemp = vi.fn(() => "/tmp/spoonjoy-qa-kitchen-abc123");
      const io = { log: vi.fn() };
      const tmpFile = "/tmp/spoonjoy-qa-kitchen-abc123/kitchen-reset.sql";

      main(["--target-env", "qa", "--credentials-out", "/tmp/creds.json"], { execFile, writeFile, mkdtemp, rm, io });

      expect(mkdtemp).toHaveBeenCalledTimes(1);
      expect(writeFile).toHaveBeenCalledTimes(2);
      expect(writeFile.mock.calls[0][0]).toBe(tmpFile);
      expect(writeFile.mock.calls[0][1]).toContain('INSERT INTO "User"');
      expect(writeFile.mock.calls[0][2]).toEqual({ encoding: "utf8", mode: 0o600 });

      expect(execFile).toHaveBeenCalledTimes(1);
      expect(execFile.mock.calls[0][0]).toBe("pnpm");
      expect(execFile.mock.calls[0][1]).toEqual([
        "exec",
        "wrangler",
        "d1",
        "execute",
        "DB",
        "--remote",
        "--env",
        "qa",
        "--file",
        tmpFile,
      ]);

      expect(rm).toHaveBeenCalledWith(tmpFile);

      expect(writeFile.mock.calls[1][0]).toBe("/tmp/creds.json");
      const credentials = JSON.parse(writeFile.mock.calls[1][1] as string);
      expect(credentials).toEqual({
        chef: { username: "qa_kitchen_chef", email: "qa-kitchen-chef@example.com", password: expect.any(String) },
        friend: { username: "qa_kitchen_friend", email: "qa-kitchen-friend@example.com", password: expect.any(String) },
        newbie: { username: "qa_kitchen_newbie", email: "qa-kitchen-newbie@example.com", password: expect.any(String) },
      });
      expect(writeFile.mock.calls[1][2]).toEqual({ encoding: "utf8", mode: 0o600 });
      expect(io.log).not.toHaveBeenCalled();
    });

    it("runs wrangler and writes no credentials file when --credentials-out is not given", () => {
      const execFile = vi.fn();
      const writeFile = vi.fn();
      const rm = vi.fn();
      const mkdtemp = vi.fn(() => "/tmp/spoonjoy-qa-kitchen-noout");
      const io = { log: vi.fn() };

      main(["--target-env", "qa"], { execFile, writeFile, mkdtemp, rm, io });

      expect(execFile).toHaveBeenCalledTimes(1);
      expect(rm).toHaveBeenCalledWith("/tmp/spoonjoy-qa-kitchen-noout/kitchen-reset.sql");
      expect(writeFile).toHaveBeenCalledTimes(1);
    });

    it("still removes the temp file and rethrows when wrangler fails, writing no credentials", () => {
      const wranglerError = new Error("wrangler failed");
      const execFile = vi.fn(() => {
        throw wranglerError;
      });
      const writeFile = vi.fn();
      const rm = vi.fn();
      const mkdtemp = vi.fn(() => "/tmp/spoonjoy-qa-kitchen-def456");
      const io = { log: vi.fn() };

      expect(() => main(["--target-env", "qa"], { execFile, writeFile, mkdtemp, rm, io })).toThrow(wranglerError);

      expect(rm).toHaveBeenCalledWith("/tmp/spoonjoy-qa-kitchen-def456/kitchen-reset.sql");
      expect(writeFile).toHaveBeenCalledTimes(1);
    });

    it("prints redacted SQL and performs no side effects in dry-run mode", () => {
      const execFile = vi.fn();
      const writeFile = vi.fn();
      const rm = vi.fn();
      const mkdtemp = vi.fn();
      const log = vi.fn();

      main(["--target-env", "qa", "--dry-run", "--credentials-out", "/tmp/creds.json"], {
        execFile,
        writeFile,
        mkdtemp,
        rm,
        io: { log },
      });

      expect(execFile).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
      expect(mkdtemp).not.toHaveBeenCalled();
      expect(rm).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledTimes(1);
      const printed = log.mock.calls[0][0] as string;
      expect(printed).toContain('INSERT INTO "User"');
      expect(printed).toContain("<hash>");
      expect(printed).not.toMatch(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{22,53}/);
    });

    it("uses process.argv and real dependencies by default", () => {
      const originalArgv = process.argv;
      process.argv = [originalArgv[0], originalArgv[1], "--target-env", "qa", "--dry-run"];
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        main();
        expect(log).toHaveBeenCalledTimes(1);
      } finally {
        log.mockRestore();
        process.argv = originalArgv;
      }
    });
  });

  describe("CLI guard", () => {
    it("detects the CLI entrypoint from a module URL and argv[1]", () => {
      expect(isCliEntry("file:///tmp/seed-qa-kitchen.mjs", "/tmp/seed-qa-kitchen.mjs")).toBe(true);
      expect(isCliEntry("file:///tmp/seed-qa-kitchen.mjs", undefined)).toBe(false);
      expect(isCliEntry("file:///tmp/seed-qa-kitchen.mjs", "/tmp/other.mjs")).toBe(false);
    });

    it("runs the injected main only when the module URL matches argv[1], and reports errors via onError", () => {
      const runMain = vi.fn();
      const onError = vi.fn();

      expect(
        runCliIfEntry({
          moduleUrl: "file:///tmp/other.mjs",
          argv1: "/tmp/seed-qa-kitchen.mjs",
          runMain,
          onError,
        }),
      ).toBe(false);
      expect(runMain).not.toHaveBeenCalled();

      expect(
        runCliIfEntry({
          moduleUrl: "file:///tmp/seed-qa-kitchen.mjs",
          argv1: "/tmp/seed-qa-kitchen.mjs",
          runMain,
          onError,
        }),
      ).toBe(true);
      expect(runMain).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();

      const failure = new Error("boom");
      const failingMain = vi.fn(() => {
        throw failure;
      });
      expect(
        runCliIfEntry({
          moduleUrl: "file:///tmp/seed-qa-kitchen.mjs",
          argv1: "/tmp/seed-qa-kitchen.mjs",
          runMain: failingMain,
          onError,
        }),
      ).toBe(true);
      expect(onError).toHaveBeenCalledWith(failure);
    });

    it("uses import.meta.url and process.argv[1] by default, and never runs from a test module", () => {
      expect(runCliIfEntry()).toBe(false);
    });

    it("prints an Error message and sets a failing exit code by default", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const originalExitCode = process.exitCode;
      try {
        defaultCliErrorHandler(new Error("kaboom"));
        expect(errorSpy).toHaveBeenCalledWith("kaboom");
        expect(process.exitCode).toBe(1);
      } finally {
        errorSpy.mockRestore();
        process.exitCode = originalExitCode;
      }
    });

    it("stringifies a non-Error thrown value", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const originalExitCode = process.exitCode;
      try {
        defaultCliErrorHandler("plain string failure");
        expect(errorSpy).toHaveBeenCalledWith("plain string failure");
      } finally {
        errorSpy.mockRestore();
        process.exitCode = originalExitCode;
      }
    });
  });
});
