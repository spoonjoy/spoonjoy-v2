import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { afterEach, describe, expect, it } from "vitest";
import { main, parseArgs } from "../../scripts/self-host-smoke-seed.mjs";
import { KITCHEN, SCRATCH_USER_COUNT } from "../../scripts/seed-qa-kitchen.mjs";
// @ts-expect-error -- plain ESM module shipped in the image, without types
import { migrationFiles, splitSql } from "../../self-host/migrations.mjs";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
function folder() {
  const made = mkdtempSync(join(tmpdir(), "self-host-seed-"));
  folders.push(made);
  return made;
}

// The way the image's `server.mjs sql <file>` runs a file: split, then statement by statement.
function applyLikeTheImage(db: Database.Database, sql: string) {
  db.transaction(() => {
    for (const statement of splitSql(sql)) db.prepare(statement).run();
  })();
}

function migratedDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const file of migrationFiles("migrations")) applyLikeTheImage(db, file.statements.join("\n"));
  return db;
}

describe("self-host-smoke-seed", () => {
  it("needs both output paths", () => {
    expect(() => parseArgs([])).toThrow(/--sql-out/);
    expect(() => parseArgs(["--sql-out", "a.sql"])).toThrow(/--credentials-out/);
    expect(() => parseArgs(["--sql-out", "--credentials-out", "c.json"])).toThrow(/--sql-out/);
    expect(parseArgs(["--sql-out", "a.sql", "--credentials-out", "c.json"])).toEqual({ sqlOut: "a.sql", credentialsOut: "c.json" });
  });

  it("writes the QA kitchen and its scratch users as SQL the image runs, with credentials for the journeys", () => {
    const out = folder();
    const sqlOut = join(out, "kitchen.sql");
    const credentialsOut = join(out, "credentials.json");
    main(["--sql-out", sqlOut, "--credentials-out", credentialsOut], { hash: (password: string) => bcrypt.hashSync(password, 4) });

    expect(statSync(sqlOut).mode & 0o777).toBe(0o600);
    expect(statSync(credentialsOut).mode & 0o777).toBe(0o600);

    const credentials = JSON.parse(readFileSync(credentialsOut, "utf8"));
    expect(credentials.chef.username).toBe(KITCHEN.chef.username);
    expect(credentials.scratch).toHaveLength(SCRATCH_USER_COUNT);
    expect(credentials.scratchDesktop).toHaveLength(SCRATCH_USER_COUNT);

    const db = migratedDb();
    applyLikeTheImage(db, readFileSync(sqlOut, "utf8"));
    const chef = db.prepare('SELECT hashedPassword FROM "User" WHERE username = ?').get(KITCHEN.chef.username) as { hashedPassword: string };
    expect(bcrypt.compareSync(credentials.chef.password, chef.hashedPassword)).toBe(true);
    const scratch = db.prepare('SELECT hashedPassword FROM "User" WHERE username = ?').get(credentials.scratchDesktop[2].username) as { hashedPassword: string };
    expect(bcrypt.compareSync(credentials.scratchDesktop[2].password, scratch.hashedPassword)).toBe(true);
    expect(db.prepare("SELECT COUNT(*) n FROM Recipe WHERE chefId = ?").get(KITCHEN.friend.id)).toEqual({ n: 2 });
  });

  it("hashes with bcrypt's cost of 10 by default, like the QA seed", () => {
    const out = folder();
    main(["--sql-out", join(out, "kitchen.sql"), "--credentials-out", join(out, "credentials.json")]);
    expect(readFileSync(join(out, "kitchen.sql"), "utf8")).toMatch(/\$2[aby]\$10\$/);
  }, 30_000);
});
