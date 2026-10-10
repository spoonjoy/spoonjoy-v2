import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/deploy-production-canary";

const ROOT_MIGRATION = resolve(__dirname, "../../migrations/0029_email_verification.sql");
const PRISMA_MIGRATION = resolve(
  __dirname,
  "../../prisma/migrations/20261009060000_email_verification/migration.sql",
);

function preMigrationDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "email" TEXT NOT NULL,
      "username" TEXT NOT NULL
    );
    INSERT INTO "User" ("id", "email", "username") VALUES ('existing-user', 'chef@example.com', 'chef');
  `);
  return db;
}

describe("migration 0029 copies", () => {
  it("keeps root D1 and Prisma migration SQL byte-identical", () => {
    expect(readFileSync(ROOT_MIGRATION, "utf8")).toBe(readFileSync(PRISMA_MIGRATION, "utf8"));
  });
});

describe("migration 0029 - email verification", () => {
  const sql = readFileSync(ROOT_MIGRATION, "utf8");

  it("is additive so the production release can apply it automatically", () => {
    expect(() => assertAdditiveMigrationSql("0029_email_verification.sql", sql)).not.toThrow();
  });

  it("starts every existing account unverified", () => {
    const db = preMigrationDb();
    db.exec(sql);
    expect(db.prepare(`SELECT "emailVerifiedAt" FROM "User" WHERE "id" = 'existing-user'`).get())
      .toEqual({ emailVerifiedAt: null });
  });

  it("stores one row per token hash, only for known purposes, and drops tokens with their user", () => {
    const db = preMigrationDb();
    db.exec(sql);
    const insert = db.prepare(`INSERT INTO "AccountEmailToken" ("id", "userId", "purpose", "tokenHash", "email", "expiresAt")
      VALUES (?, 'existing-user', ?, ?, 'chef@example.com', '2030-01-01T00:00:00.000Z')`);

    insert.run("t1", "verify_email", "hash-1");
    expect(() => insert.run("t2", "reset_password", "hash-1")).toThrow(/UNIQUE/);
    expect(() => insert.run("t3", "make_admin", "hash-3")).toThrow(/CHECK/);

    db.exec(`DELETE FROM "User" WHERE "id" = 'existing-user'`);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM "AccountEmailToken"`).get()).toEqual({ n: 0 });
  });
});
