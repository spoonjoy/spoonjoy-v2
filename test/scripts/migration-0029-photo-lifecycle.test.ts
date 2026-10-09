import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/deploy-production-canary";

const ROOT_MIGRATION = resolve(__dirname, "../../migrations/0029_photo_lifecycle.sql");
const PRISMA_MIGRATION = resolve(__dirname, "../../prisma/migrations/20261009120000_photo_lifecycle/migration.sql");

describe("migration 0029 - photo lifecycle", () => {
  const sql = readFileSync(ROOT_MIGRATION, "utf8");

  it("keeps root D1 and Prisma migration SQL byte-identical", () => {
    expect(sql).toBe(readFileSync(PRISMA_MIGRATION, "utf8"));
  });

  it("is additive so the production release can apply it automatically", () => {
    expect(() => assertAdditiveMigrationSql("0029_photo_lifecycle.sql", sql)).not.toThrow();
  });

  it("creates the bookkeeping tables and can be applied twice", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(sql);
    db.exec(sql);
    const tables = db.prepare(`SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' ORDER BY "name"`).all();
    expect(tables).toEqual([{ name: "PhotoCleanup" }, { name: "PhotoSweepRun" }]);
    db.exec(`INSERT INTO "PhotoSweepRun" ("id", "mode", "startedAt", "finishedAt") VALUES ('r', 'dry-run', '2026-10-09', '2026-10-09')`);
    expect(db.prepare(`SELECT "truncated", "objectsScanned" FROM "PhotoSweepRun"`).get()).toEqual({ truncated: 0, objectsScanned: 0 });
  });
});
