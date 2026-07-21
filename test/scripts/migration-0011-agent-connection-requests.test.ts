import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import DatabaseSync from "better-sqlite3";
type DatabaseSyncType = InstanceType<typeof DatabaseSync>;


const MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "..",
  "migrations",
  "0011_agent_connection_requests.sql",
);

interface TableInfoRow {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface IndexListRow {
  name: string;
  unique: number;
}

interface ForeignKeyRow {
  table: string;
  from: string;
  on_delete: string;
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
      CONSTRAINT "ApiCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
  `);
  return db;
}

describe("migration 0011 — agent connection requests", () => {
  let db: DatabaseSyncType;

  beforeAll(() => {
    db = freshDb();
    db.exec(readFileSync(MIGRATION_PATH, "utf8"));
  });

  it("creates the request table with device-flow columns", () => {
    const rows = db.prepare(`PRAGMA table_info("AgentConnectionRequest")`).all() as unknown as TableInfoRow[];
    const cols = Object.fromEntries(rows.map((row) => [row.name, row]));

    expect(cols.id).toMatchObject({ type: "TEXT", notnull: 1, pk: 1 });
    expect(cols.deviceCodeHash).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(cols.userCode).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(cols.agentName).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(cols.scopes.dflt_value).toBe("'kitchen:read kitchen:write'");
    expect(cols.status.dflt_value).toBe("'pending'");
    expect(cols.approvedById).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(cols.credentialId).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(cols.expiresAt).toMatchObject({ type: "DATETIME", notnull: 1 });
    expect(cols.claimedAt).toMatchObject({ type: "DATETIME", notnull: 0 });
  });

  it("declares uniqueness and lookup indexes", () => {
    const rows = db.prepare(`PRAGMA index_list("AgentConnectionRequest")`).all() as unknown as IndexListRow[];
    const indexes = Object.fromEntries(rows.map((row) => [row.name, row]));

    expect(indexes.AgentConnectionRequest_deviceCodeHash_key.unique).toBe(1);
    expect(indexes.AgentConnectionRequest_userCode_key.unique).toBe(1);
    expect(indexes.AgentConnectionRequest_approvedById_idx.unique).toBe(0);
    expect(indexes.AgentConnectionRequest_credentialId_idx.unique).toBe(0);
    expect(indexes.AgentConnectionRequest_status_expiresAt_idx.unique).toBe(0);
  });

  it("keeps approved users and generated credentials nullable on deletion", () => {
    const rows = db.prepare(`PRAGMA foreign_key_list("AgentConnectionRequest")`).all() as unknown as ForeignKeyRow[];
    const byColumn = Object.fromEntries(rows.map((row) => [row.from, row]));

    expect(byColumn.approvedById).toMatchObject({ table: "User", on_delete: "SET NULL" });
    expect(byColumn.credentialId).toMatchObject({ table: "ApiCredential", on_delete: "SET NULL" });
  });
});
