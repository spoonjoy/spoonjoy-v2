import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM module shipped in the image, without types
import { MIGRATIONS_TABLE_SQL, applyMigrations, migrationFiles, splitSql } from "../../self-host/migrations.mjs";

describe("splitSql", () => {
  it("splits on semicolons and drops comments", () => {
    expect(splitSql("-- a note; with a semicolon\nCREATE TABLE a (x);\n/* b; */ INSERT INTO a VALUES (1);")).toEqual([
      "CREATE TABLE a (x);",
      "INSERT INTO a VALUES (1);",
    ]);
  });

  it("keeps semicolons inside quoted strings and identifiers", () => {
    expect(splitSql(`INSERT INTO a VALUES ('x; ''y''');\nSELECT "c;d", [e;f], \`g;h\` FROM a;`)).toEqual([
      "INSERT INTO a VALUES ('x; ''y''');",
      'SELECT "c;d", [e;f], `g;h` FROM a;',
    ]);
  });

  it("keeps a trigger body whole until its END", () => {
    const sql = "CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE b SET n = n + 1; DELETE FROM c; END;\nSELECT 1;";
    expect(splitSql(sql)).toEqual([
      "CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE b SET n = n + 1; DELETE FROM c; END;",
      "SELECT 1;",
    ]);
  });

  it("keeps a last statement with no semicolon, and ignores an unterminated comment", () => {
    expect(splitSql("SELECT 1;\nSELECT 2")).toEqual(["SELECT 1;", "SELECT 2"]);
    expect(splitSql("SELECT 1; /* never closed")).toEqual(["SELECT 1;"]);
    expect(splitSql("SELECT 1; -- trailing")).toEqual(["SELECT 1;"]);
    expect(splitSql("SELECT 'never closed")).toEqual(["SELECT 'never closed"]);
  });
});

// A D1-shaped wrapper over an in-memory SQLite database: the calls applyMigrations makes.
function d1(db: Database.Database) {
  const prepare = (sql: string) => {
    const statement = { sql, args: [] as unknown[], bind: (...args: unknown[]) => ({ ...statement, args }) };
    return statement;
  };
  return {
    exec: async (sql: string) => { db.exec(sql); },
    prepare: (sql: string) => ({
      ...prepare(sql),
      all: async () => ({ results: db.prepare(sql).all() }),
    }),
    batch: async (statements: { sql: string; args: unknown[] }[]) => {
      db.transaction(() => {
        for (const s of statements) {
          const prepared = db.prepare(s.sql);
          if (prepared.reader) prepared.all(...s.args); else prepared.run(...s.args);
        }
      })();
    },
  };
}

describe("applyMigrations", () => {
  it("runs every migration in migrations/ on an empty database, and records each like wrangler", async () => {
    const db = new Database(":memory:");
    const files = migrationFiles("migrations");
    expect(files.length).toBeGreaterThan(40);
    const result = await applyMigrations(d1(db), files);
    expect(result).toEqual({ ran: files.length, total: files.length });
    const names = db.prepare("SELECT name FROM d1_migrations ORDER BY id").all().map((row) => (row as { name: string }).name);
    expect(names).toEqual(files.map((file: { name: string }) => file.name));
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'User'").get()).toBeTruthy();
  });

  it("runs only the migrations not yet recorded on the next start", async () => {
    const db = new Database(":memory:");
    const files = migrationFiles("migrations");
    await applyMigrations(d1(db), files.slice(0, 5));
    expect(await applyMigrations(d1(db), files)).toEqual({ ran: files.length - 5, total: files.length });
    expect(await applyMigrations(d1(db), files)).toEqual({ ran: 0, total: files.length });
  });

  it("creates the same tracking table wrangler does", () => {
    expect(MIGRATIONS_TABLE_SQL).toContain("CREATE TABLE IF NOT EXISTS d1_migrations");
  });
});
