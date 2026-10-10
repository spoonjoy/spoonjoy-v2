import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/deploy-production-canary";

const ROOT_MIGRATION = resolve(__dirname, "../../migrations/0030_agent_connection_requester.sql");
const PRISMA_MIGRATION = resolve(
  __dirname,
  "../../prisma/migrations/20261009120000_agent_connection_requester/migration.sql",
);

describe("migration 0030 copies", () => {
  it("keeps root D1 and Prisma migration SQL byte-identical", () => {
    expect(readFileSync(ROOT_MIGRATION, "utf8")).toBe(readFileSync(PRISMA_MIGRATION, "utf8"));
  });
});

describe("migration 0030 - agent connection requester details", () => {
  const sql = readFileSync(ROOT_MIGRATION, "utf8");

  it("is additive so the production release can apply it automatically", () => {
    expect(() => assertAdditiveMigrationSql("0030_agent_connection_requester.sql", sql)).not.toThrow();
  });

  it("adds nullable requester columns and leaves existing requests untouched", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE "AgentConnectionRequest" ("id" TEXT NOT NULL PRIMARY KEY, "agentName" TEXT NOT NULL);
      INSERT INTO "AgentConnectionRequest" ("id", "agentName") VALUES ('existing', 'slugger');
    `);

    db.exec(sql);

    const columns = db.prepare(`PRAGMA table_info("AgentConnectionRequest")`).all() as Array<{ name: string; type: string; notnull: number }>;
    for (const name of ["requesterIp", "requesterUserAgent", "requesterCountry"]) {
      expect(columns.find((column) => column.name === name)).toMatchObject({ type: "TEXT", notnull: 0 });
    }
    expect(db.prepare(`SELECT * FROM "AgentConnectionRequest" WHERE "id" = 'existing'`).get()).toEqual({
      id: "existing",
      agentName: "slugger",
      requesterIp: null,
      requesterUserAgent: null,
      requesterCountry: null,
    });
  });
});
