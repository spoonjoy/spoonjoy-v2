import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");

const MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "..",
  "migrations",
  "0015_api_credential_scopes.sql",
);

interface TableInfoRow {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

function freshDb(): DatabaseSyncType {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "email" TEXT NOT NULL,
      "username" TEXT NOT NULL
    );
    CREATE TABLE "ApiCredential" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "tokenHash" TEXT NOT NULL,
      "tokenPrefix" TEXT NOT NULL,
      "lastUsedAt" DATETIME,
      "revokedAt" DATETIME,
      "expiresAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ApiCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
  `);
  return db;
}

describe("migration 0015 — API credential scopes", () => {
  let db: DatabaseSyncType;

  beforeAll(() => {
    db = freshDb();
    db.exec(readFileSync(MIGRATION_PATH, "utf8"));
  });

  it("adds required scopes with the legacy broad default", () => {
    const rows = db.prepare(`PRAGMA table_info("ApiCredential")`).all() as unknown as TableInfoRow[];
    const cols = Object.fromEntries(rows.map((row) => [row.name, row]));

    expect(cols.scopes).toMatchObject({
      type: "TEXT",
      notnull: 1,
      dflt_value: "'kitchen:read kitchen:write'",
    });
  });

  it("backfills existing credentials with the legacy broad scopes", () => {
    db.exec(`
      INSERT INTO "User" ("id", "email", "username") VALUES ('user-1', 'u@example.com', 'chef');
      INSERT INTO "ApiCredential" ("id", "userId", "name", "tokenHash", "tokenPrefix")
      VALUES ('cred-1', 'user-1', 'Client', 'hash', 'sj_prefix');
    `);

    const row = db.prepare(`SELECT "scopes" FROM "ApiCredential" WHERE "id" = 'cred-1'`).get() as { scopes: string };
    expect(row.scopes).toBe("kitchen:read kitchen:write");
  });
});
