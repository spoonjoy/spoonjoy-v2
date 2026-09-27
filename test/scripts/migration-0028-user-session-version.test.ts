import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/deploy-production-canary";

const ROOT_MIGRATION = resolve(__dirname, "../../migrations/0028_user_session_version.sql");
const PRISMA_MIGRATION = resolve(
  __dirname,
  "../../prisma/migrations/20260926230000_user_session_version/migration.sql",
);

interface TableInfoRow {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
}

function preMigrationDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "email" TEXT NOT NULL,
      "username" TEXT NOT NULL
    );
    INSERT INTO "User" ("id", "email", "username") VALUES ('existing-user', 'chef@example.com', 'chef');
  `);
  return db;
}

describe("migration 0028 copies", () => {
  it("keeps root D1 and Prisma migration SQL byte-identical", () => {
    expect(readFileSync(ROOT_MIGRATION, "utf8")).toBe(readFileSync(PRISMA_MIGRATION, "utf8"));
  });
});

describe("migration 0028 - user session version", () => {
  const sql = readFileSync(ROOT_MIGRATION, "utf8");

  it("is additive so the production release can apply it automatically", () => {
    expect(() => assertAdditiveMigrationSql("0028_user_session_version.sql", sql)).not.toThrow();
  });

  it("adds a non-null integer version that starts existing users at 0", () => {
    const db = preMigrationDb();

    db.exec(sql);

    const columns = db.prepare(`PRAGMA table_info("User")`).all() as TableInfoRow[];
    expect(columns.find((column) => column.name === "sessionVersion")).toMatchObject({
      type: "INTEGER",
      notnull: 1,
      dflt_value: "0",
    });
    expect(db.prepare(`SELECT "sessionVersion" FROM "User" WHERE "id" = 'existing-user'`).get())
      .toEqual({ sessionVersion: 0 });
  });

  it("lets a worker that does not know the column keep inserting users", () => {
    const db = preMigrationDb();
    db.exec(sql);

    db.exec(`INSERT INTO "User" ("id", "email", "username") VALUES ('new-user', 'new@example.com', 'new')`);

    expect(db.prepare(`SELECT "sessionVersion" FROM "User" WHERE "id" = 'new-user'`).get())
      .toEqual({ sessionVersion: 0 });
  });
});
