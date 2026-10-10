import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/deploy-production-canary";

const ROOT_MIGRATION = resolve(__dirname, "../../migrations/0031_oauth_token_expiry.sql");
const PRISMA_MIGRATION = resolve(
  __dirname,
  "../../prisma/migrations/20261009130000_oauth_token_expiry/migration.sql",
);

describe("migration 0031 - OAuth refresh token expiry", () => {
  const sql = readFileSync(ROOT_MIGRATION, "utf8");

  it("keeps root D1 and Prisma migration SQL byte-identical", () => {
    expect(sql).toBe(readFileSync(PRISMA_MIGRATION, "utf8"));
  });

  it("is additive so the production release can apply it automatically", () => {
    expect(() => assertAdditiveMigrationSql("0031_oauth_token_expiry.sql", sql)).not.toThrow();
  });

  it("adds a nullable expiry and leaves existing refresh tokens untouched", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE "OAuthRefreshToken" ("id" TEXT NOT NULL PRIMARY KEY, "tokenHash" TEXT NOT NULL, "revokedAt" DATETIME);
      INSERT INTO "OAuthRefreshToken" ("id", "tokenHash") VALUES ('existing', 'hash');
    `);

    db.exec(sql);

    expect(db.prepare(`SELECT "id", "expiresAt" FROM "OAuthRefreshToken"`).all())
      .toEqual([{ id: "existing", expiresAt: null }]);
    db.exec(`INSERT INTO "OAuthRefreshToken" ("id", "tokenHash") VALUES ('old-worker', 'hash2')`);
    expect(db.prepare(`SELECT "expiresAt" FROM "OAuthRefreshToken" WHERE "id" = 'old-worker'`).get())
      .toEqual({ expiresAt: null });
  });
});
