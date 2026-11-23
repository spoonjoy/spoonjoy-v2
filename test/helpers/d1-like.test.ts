import { afterEach, describe, expect, it } from "vitest";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "./cleanup";
import { createTestRecipe, createTestUser } from "../utils";
import { d1Like } from "./d1-like";
import { migratedSqliteD1, type MigratedSqlite } from "./migrated-sqlite";

let database: MigratedSqlite | undefined;
afterEach(async () => {
  database?.close();
  database = undefined;
  await cleanupDatabase();
});

describe("the test databases' LIKE", () => {
  it("matches as SQLite does: % and _, ASCII case folded, an escape, and null", () => {
    expect(d1Like("Soup (%)", "soup (2)")).toBe(1);
    expect(d1Like("Soup (_)", "Soup (12)")).toBe(0);
    expect(d1Like("50!%", "50%", "!")).toBe(1);
    expect(d1Like("50!%", "500", "!")).toBe(0);
    expect(d1Like("a.c", "abc")).toBe(0);
    expect(d1Like("ÉCLAIR", "éclair")).toBe(0);
    expect(d1Like(null, "x")).toBeNull();
    expect(d1Like("x", null)).toBeNull();
  });

  it("refuses a pattern over D1's 50 bytes in the migrated database, as D1 does", () => {
    database = migratedSqliteD1();
    const long = `${"a".repeat(47)} (%)`;
    expect(() => database?.sqlite.prepare(`SELECT 1 WHERE 'x' LIKE ?`).get(long)).toThrow("LIKE or GLOB pattern too complex");
    expect(database.sqlite.prepare(`SELECT 'Soup (2)' LIKE ? AS hit`).get("Soup (%)")).toEqual({ hit: 1 });
  });

  it("refuses a Prisma contains over 48 bytes, as D1 does, and keeps one that fits", async () => {
    const db = await getLocalDb();
    // LIKE checks its pattern only when it runs on a row, on D1 as in SQLite, so there must be one.
    const chef = await db.user.create({ data: createTestUser() });
    await db.recipe.create({ data: { ...createTestRecipe(chef.id), title: "Soup" } });
    await expect(db.recipe.findMany({ where: { title: { contains: "a".repeat(49) } } })).rejects.toThrow("LIKE or GLOB pattern too complex");
    await expect(db.recipe.findMany({ where: { title: { contains: "a".repeat(48) } } })).resolves.toEqual([]);
  });
});
