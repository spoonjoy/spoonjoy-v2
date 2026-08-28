import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import DatabaseSync from "better-sqlite3";

const MIGRATION_PATH = resolve(__dirname, "..", "..", "migrations", "0025_oauth_client_revocation.sql");

describe("migration 0025 - OAuth client revocation", () => {
  it("adds a nullable DATETIME tombstone and preserves existing clients as active", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE OAuthClient (
        id TEXT NOT NULL PRIMARY KEY,
        clientName TEXT,
        redirectUris TEXT NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO OAuthClient (id, clientName, redirectUris)
      VALUES ('existing', 'Example App', 'https://example.com/cb');
    `);

    db.exec(readFileSync(MIGRATION_PATH, "utf8"));

    const columns = db.prepare("PRAGMA table_info('OAuthClient')").all() as Array<{
      name: string;
      type: string;
      notnull: number;
    }>;
    const column = columns.find((candidate) => candidate.name === "revokedAt");
    expect(column).toMatchObject({ type: "DATETIME", notnull: 0 });
    expect(db.prepare("SELECT revokedAt FROM OAuthClient WHERE id = 'existing'").get())
      .toEqual({ revokedAt: null });
  });
});
