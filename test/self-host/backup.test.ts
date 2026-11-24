import Database from "better-sqlite3";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backupFileName,
  createBackup,
  listBackups,
  listPhotos,
  planSchema,
  pruneBackups,
  readTarGz,
  restoreBackup,
  restoreStatements,
  tableOrder,
  tarHeader,
  writeTarGz,
  // @ts-expect-error -- plain ESM module shipped in the image, without types
} from "../../self-host/backup.mjs";

type Row = Record<string, unknown>;
type Statement = { sql: string; args: unknown[]; bind: (...args: unknown[]) => Statement; all: () => Promise<{ results: Row[] }> };

// A D1-shaped wrapper over SQLite with foreign keys on, as D1 has them. Miniflare hands BLOBs back
// as arrays of byte values, so `blobs: "arrays"` does too; better-sqlite3 itself gives Buffers.
function d1(db: Database.Database, { blobs = "arrays", beforeBatch }: { blobs?: "arrays" | "bytes"; beforeBatch?: () => void } = {}) {
  const shape = (row: Row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, blobs === "arrays" && Buffer.isBuffer(value) ? [...value] : value]));
  const run = (sql: string, args: unknown[]) => {
    const statement = db.prepare(sql);
    const bound = args.map((arg) => (arg instanceof Uint8Array ? Buffer.from(arg) : arg));
    if (statement.reader) return (statement.all(...bound) as Row[]).map(shape);
    statement.run(...bound);
    return [];
  };
  const prepare = (sql: string): Statement => {
    const make = (args: unknown[]): Statement => ({
      sql,
      args,
      bind: (...next: unknown[]) => make(next),
      all: async () => ({ results: run(sql, args) }),
    });
    return make([]);
  };
  return {
    prepare,
    batch: async (statements: Statement[]) => {
      beforeBatch?.();
      return db.transaction(() => statements.map((statement) => ({ results: run(statement.sql, statement.args) })))();
    },
  };
}

type Stored = { key: string; data: Uint8Array; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> };

// An R2-shaped photo store that pages its listing two objects at a time.
function r2(objects: Stored[] = [], { lose }: { lose?: string } = {}) {
  const store = new Map(objects.map((object) => [object.key, object]));
  return {
    store,
    list: async ({ cursor }: { cursor?: string }) => {
      const keys = [...store.keys()].sort();
      const start = cursor ? Number(cursor) : 0;
      const page = keys.slice(start, start + 2).map((key) => {
        const object = store.get(key)!;
        return { key, size: object.data.length, httpMetadata: object.httpMetadata, customMetadata: object.customMetadata };
      });
      const truncated = start + 2 < keys.length;
      return { objects: page, truncated, ...(truncated ? { cursor: String(start + 2) } : {}) };
    },
    get: async (key: string) => {
      const object = key === lose ? undefined : store.get(key);
      return object ? { arrayBuffer: async () => object.data.buffer.slice(object.data.byteOffset, object.data.byteOffset + object.data.length) } : null;
    },
    put: async (key: string, data: Uint8Array, options: Omit<Stored, "key" | "data"> = {}) => {
      store.set(key, { key, data: new Uint8Array(data), ...options });
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  };
}

const KITCHEN_SCHEMA = [
  "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",
  'CREATE TABLE "User" ("id" TEXT NOT NULL PRIMARY KEY, "email" TEXT NOT NULL)',
  'CREATE UNIQUE INDEX "User_email_key" ON "User"("email")',
  'CREATE TABLE "UserCredential" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "publicKey" BLOB NOT NULL, CONSTRAINT "UserCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT)',
  'CREATE TABLE "Recipe" ("id" TEXT NOT NULL PRIMARY KEY, "chefId" TEXT NOT NULL REFERENCES "User" ("id") ON DELETE CASCADE, "title" TEXT NOT NULL, "activeCoverId" TEXT)',
  'CREATE TABLE "RecipeCover" ("id" TEXT NOT NULL PRIMARY KEY, "recipeId" TEXT NOT NULL REFERENCES "Recipe" ("id") ON DELETE CASCADE, "imageUrl" TEXT NOT NULL, "createdById" TEXT REFERENCES "User" ("id") ON DELETE SET NULL)',
  'CREATE TABLE "Empty" ("id" TEXT NOT NULL PRIMARY KEY)',
  'CREATE TABLE "_cf_KV" (key TEXT PRIMARY KEY, value BLOB)',
  'CREATE VIRTUAL TABLE "SearchDocument" USING fts5(title)',
  'CREATE TRIGGER "Recipe_cover_gone" AFTER DELETE ON "RecipeCover" BEGIN UPDATE "Recipe" SET "activeCoverId" = NULL WHERE "activeCoverId" = OLD."id"; END',
  'CREATE VIEW "RecipeTitles" AS SELECT "title" FROM "Recipe"',
];

function kitchen() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const sql of KITCHEN_SCHEMA) db.exec(sql);
  db.prepare("INSERT INTO d1_migrations (name) VALUES (?), (?)").run("0000_init.sql", "0001_recipes.sql");
  db.prepare('INSERT INTO "User" VALUES (?, ?)').run("chef", "chef@example.test");
  db.prepare('INSERT INTO "UserCredential" VALUES (?, ?, ?)').run("key", "chef", Buffer.from([0, 1, 254, 255]));
  db.prepare('INSERT INTO "Recipe" VALUES (?, ?, ?, ?)').run("risotto", "chef", "Saffron Risotto", "cover");
  db.prepare('INSERT INTO "RecipeCover" VALUES (?, ?, ?, ?)').run("cover", "risotto", "/photos/covers/risotto.jpg", "chef");
  db.prepare('INSERT INTO "_cf_KV" VALUES (?, ?)').run("internal", Buffer.from([1]));
  db.prepare('INSERT INTO "SearchDocument" VALUES (?)').run("Saffron Risotto");
  return db;
}

const photo = (key: string, bytes: number[], contentType?: string): Stored => ({
  key,
  data: new Uint8Array(bytes),
  ...(contentType ? { httpMetadata: { contentType } } : {}),
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "spoonjoy-backup-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function entriesOf(file: string) {
  const out: { name: string; data: Buffer }[] = [];
  for await (const entry of readTarGz(file)) out.push(entry);
  return out;
}

async function* listOf(entries: { name: string; data: string | Uint8Array }[]) {
  yield* entries;
}

describe("the backup archive", () => {
  it("reads back what it wrote, whatever the entries' sizes", async () => {
    const file = path.join(dir, "a.tar.gz");
    const big = new Uint8Array(200_000).map((_, i) => i % 251);
    await writeTarGz(file, listOf([
      { name: "empty", data: "" },
      { name: "block", data: new Uint8Array(512).fill(7) },
      { name: "small.json", data: '{"a":1}' },
      { name: "photos/000001", data: big },
    ]));
    const entries = await entriesOf(file);
    expect(entries.map((entry) => [entry.name, entry.data.length])).toEqual([["empty", 0], ["block", 512], ["small.json", 7], ["photos/000001", 200_000]]);
    expect(entries[2].data.toString()).toBe('{"a":1}');
    expect(Buffer.compare(entries[3].data, Buffer.from(big))).toBe(0);
    expect(readdirSync(dir)).toEqual(["a.tar.gz"]);
  });

  it("refuses an entry name too long for a tar header", () => {
    expect(() => tarHeader("x".repeat(101), 0, 0)).toThrow("longer than 100 bytes");
  });

  it("leaves no file behind when writing fails part way", async () => {
    const file = path.join(dir, "a.tar.gz");
    async function* failing() {
      yield { name: "first", data: "x" };
      throw new Error("the photo store went away");
    }
    await expect(writeTarGz(file, failing())).rejects.toThrow("the photo store went away");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("still fails cleanly when the file can't even be started", async () => {
    await expect(writeTarGz(path.join(dir, "missing", "a.tar.gz"), listOf([]))).rejects.toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("says a damaged or cut-short file is one", async () => {
    const damaged = Buffer.concat([tarHeader("a", 1, 0), Buffer.alloc(512)]);
    damaged[0] = "b".charCodeAt(0);
    writeFileSync(path.join(dir, "damaged.tar.gz"), gzipSync(damaged));
    await expect(entriesOf(path.join(dir, "damaged.tar.gz"))).rejects.toThrow("damaged");

    writeFileSync(path.join(dir, "short.tar.gz"), gzipSync(tarHeader("a", 600, 0)));
    await expect(entriesOf(path.join(dir, "short.tar.gz"))).rejects.toThrow("ends early");
  });
});

describe("planSchema", () => {
  it("keeps the tables, indexes, triggers and views, and makes the search tables empty", () => {
    const db = kitchen();
    const plan = planSchema(db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY rowid").all());
    expect(plan.tables.map((table: { name: string }) => table.name)).toEqual(["d1_migrations", "User", "UserCredential", "Recipe", "RecipeCover", "Empty"]);
    expect(plan.virtualTables.map((table: { name: string }) => table.name)).toEqual(["SearchDocument"]);
    expect(plan.indexes.map((index: { name: string }) => index.name)).toEqual(["User_email_key"]);
    expect(plan.triggers.map((trigger: { name: string }) => trigger.name)).toEqual(["Recipe_cover_gone"]);
    expect(plan.views.map((view: { name: string }) => view.name)).toEqual(["RecipeTitles"]);
  });
});

describe("tableOrder", () => {
  it("puts parents before children, and keeps a reference cycle in its own order", () => {
    const table = (name: string, sql: string) => ({ type: "table", name, sql });
    expect(tableOrder([
      table("Child", 'CREATE TABLE "Child" (p TEXT REFERENCES "Parent"(id), q TEXT REFERENCES [Other](id))'),
      table("Parent", 'CREATE TABLE "Parent" (id TEXT, up TEXT REFERENCES "Parent"(id))'),
      table("A", "CREATE TABLE A (b TEXT REFERENCES B(id))"),
      table("B", "CREATE TABLE B (a TEXT REFERENCES A(id))"),
    ]).map((entry: { name: string }) => entry.name)).toEqual(["Parent", "Child", "A", "B"]);
  });
});

describe("createBackup and restoreBackup", () => {
  const photos = () => r2([photo("covers/risotto.jpg", [1, 2, 3], "image/jpeg"), photo("covers/soup.png", [4], "image/png"), photo("avatars/chef", [5, 6])]);

  it("bring a kitchen back into another server, replacing what was there", async () => {
    const file = path.join(dir, "kitchen.tar.gz");
    const made = await createBackup({ db: d1(kitchen()), photos: photos(), file, version: "2026.11.23-abc1234", now: new Date("2026-11-23T03:17:00Z") });
    expect(made).toMatchObject({
      format: 1,
      app: "spoonjoy",
      version: "2026.11.23-abc1234",
      createdAt: "2026-11-23T03:17:00.000Z",
      migrations: ["0000_init.sql", "0001_recipes.sql"],
      tables: 6,
      rows: 6,
      photos: 3,
      photoBytes: 6,
    });

    const target = new Database(":memory:");
    target.pragma("foreign_keys = ON");
    target.exec('CREATE TABLE "User" ("id" TEXT NOT NULL PRIMARY KEY, "email" TEXT NOT NULL, "extra" TEXT)');
    target.exec('CREATE TABLE "Note" ("id" TEXT, "userId" TEXT REFERENCES "User"("id") ON DELETE SET NULL, "by" TEXT REFERENCES "User"("id"))');
    target.exec('CREATE VIRTUAL TABLE "SearchDocument" USING fts5(title)');
    target.exec('CREATE TRIGGER "old" AFTER INSERT ON "User" BEGIN SELECT 1; END');
    target.exec('CREATE VIEW "old_view" AS SELECT 1');
    target.prepare('INSERT INTO "User" VALUES (?, ?, ?)').run("stranger", "stranger@example.test", "x");
    target.prepare('INSERT INTO "Note" VALUES (?, ?, ?)').run("n", "stranger", "stranger");
    const store = r2([photo("stray.jpg", [9])]);

    const restored = await restoreBackup({ db: d1(target), photos: store, file, knownMigrations: ["0000_init.sql", "0001_recipes.sql", "0002_new.sql"] });
    expect(restored).toEqual({ file, version: "2026.11.23-abc1234", createdAt: "2026-11-23T03:17:00.000Z", rows: 6, photos: 3 });

    expect(target.prepare('SELECT * FROM "User"').all()).toEqual([{ id: "chef", email: "chef@example.test" }]);
    expect(target.prepare('SELECT hex("publicKey") AS key FROM "UserCredential"').get()).toEqual({ key: "0001FEFF" });
    expect(target.prepare('SELECT title FROM "RecipeTitles"').all()).toEqual([{ title: "Saffron Risotto" }]);
    expect(target.prepare("SELECT name FROM d1_migrations ORDER BY id").all()).toEqual([{ name: "0000_init.sql" }, { name: "0001_recipes.sql" }]);
    expect(target.prepare('SELECT COUNT(*) AS n FROM "SearchDocument"').get()).toEqual({ n: 0 });
    expect(target.prepare("SELECT name FROM sqlite_master WHERE name IN ('Note', 'old', 'old_view', '_cf_KV')").all()).toEqual([]);
    target.prepare('DELETE FROM "RecipeCover"').run();
    expect(target.prepare('SELECT "activeCoverId" FROM "Recipe"').get()).toEqual({ activeCoverId: null });
    expect(() => target.prepare('INSERT INTO "User" VALUES (?, ?)').run("twin", "chef@example.test")).toThrow("UNIQUE");

    expect([...store.store.keys()].sort()).toEqual(["avatars/chef", "covers/risotto.jpg", "covers/soup.png"]);
    expect(store.store.get("covers/risotto.jpg")).toMatchObject({ data: new Uint8Array([1, 2, 3]), httpMetadata: { contentType: "image/jpeg" }, customMetadata: {} });
    expect(store.store.get("avatars/chef")?.httpMetadata).toBeUndefined();
  });

  it("reads BLOBs handed back as bytes too, and a database with no migrations table", async () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE k (v BLOB)");
    db.prepare("INSERT INTO k VALUES (?)").run(Buffer.from([7, 8]));
    const file = path.join(dir, "bytes.tar.gz");
    const made = await createBackup({ db: d1(db, { blobs: "bytes" }), photos: r2(), file, version: "v" });
    expect(made).toMatchObject({ migrations: [], rows: 1, photos: 0 });
    const target = new Database(":memory:");
    await restoreBackup({ db: d1(target), photos: r2(), file, knownMigrations: [] });
    expect(target.prepare("SELECT hex(v) AS v FROM k").get()).toEqual({ v: "0708" });
  });

  it("refuses to finish when a photo goes missing or the schema changes mid-backup", async () => {
    await expect(createBackup({ db: d1(kitchen()), photos: r2([photo("a", [1])], { lose: "a" }), file: path.join(dir, "a.tar.gz"), version: "v" }))
      .rejects.toThrow("The photo a went missing");
    const db = kitchen();
    await expect(createBackup({ db: d1(db, { beforeBatch: () => db.exec("CREATE TABLE late (x)") }), photos: r2(), file: path.join(dir, "b.tar.gz"), version: "v" }))
      .rejects.toThrow("schema changed");
    expect(readdirSync(dir)).toEqual([]);
  });

  async function tamperedBackup(change: (entries: { name: string; data: Buffer }[]) => { name: string; data: string | Buffer }[]) {
    const good = path.join(dir, "good.tar.gz");
    if (!existsSync(good)) await createBackup({ db: d1(kitchen()), photos: photos(), file: good, version: "v" });
    const file = path.join(dir, "tampered.tar.gz");
    await writeTarGz(file, listOf(change(await entriesOf(good))));
    return file;
  }
  const untouched = () => {
    const db = kitchen();
    return { db, store: r2([photo("keep", [1])]) };
  };

  it("changes nothing for a file that isn't a Spoonjoy backup or comes from a newer Spoonjoy", async () => {
    type Change = Parameters<typeof tamperedBackup>[0];
    const cases: [Change, string][] = [
      [() => [{ name: "notes.txt", data: "hello" }], "isn't a Spoonjoy backup: it should have spoonjoy-backup.json next, not notes.txt"],
      [() => [], "not nothing"],
      [([manifest, ...rest]) => [{ name: manifest.name, data: JSON.stringify({ ...JSON.parse(manifest.data.toString()), format: 2 }) }, ...rest], "format (spoonjoy 2)"],
      [([manifest, ...rest]) => [{ name: manifest.name, data: JSON.stringify({ ...JSON.parse(manifest.data.toString()), app: "other" }) }, ...rest], "format (other 1)"],
      [(entries) => entries, "comes from a newer Spoonjoy (v): update this server's image first. It doesn't know 0001_recipes.sql"],
    ];
    for (const [change, message] of cases) {
      const file = await tamperedBackup(change);
      const { db, store } = untouched();
      await expect(restoreBackup({ db: d1(db), photos: store, file, knownMigrations: ["0000_init.sql"] })).rejects.toThrow(message);
      expect(db.prepare('SELECT COUNT(*) AS n FROM "User"').get()).toEqual({ n: 1 });
      expect([...store.store.keys()]).toEqual(["keep"]);
    }
  });

  it("says so when the photos in the file don't match its list", async () => {
    const known = ["0000_init.sql", "0001_recipes.sql"];
    const extra = await tamperedBackup((entries) => [...entries, { name: "photos/999999", data: "x" }]);
    await expect(restoreBackup({ db: d1(kitchen()), photos: r2(), file: extra, knownMigrations: known })).rejects.toThrow("a file it doesn't list: photos/999999");
    const missing = await tamperedBackup((entries) => entries.slice(0, -1));
    await expect(restoreBackup({ db: d1(kitchen()), photos: r2(), file: missing, knownMigrations: known })).rejects.toThrow("lists 3 photos but holds 2");
  });
});

describe("listPhotos", () => {
  it("follows every page of the listing", async () => {
    const store = r2([photo("a", [1]), photo("b", [1, 2], "image/png"), photo("c", [1, 2, 3])]);
    expect(await listPhotos(store)).toEqual([
      { key: "a", size: 1, contentType: null, customMetadata: {} },
      { key: "b", size: 2, contentType: "image/png", customMetadata: {} },
      { key: "c", size: 3, contentType: null, customMetadata: {} },
    ]);
  });
});

describe("restoreStatements", () => {
  it("drops what's there children first, and creates the backup's schema before its rows", () => {
    const current = [
      { type: "table", name: "Parent", tbl_name: "Parent", sql: "CREATE TABLE Parent (id TEXT)" },
      { type: "table", name: "Child", tbl_name: "Child", sql: "CREATE TABLE Child (p TEXT REFERENCES Parent(id))" },
    ];
    const backup = {
      schema: [
        { type: "table", name: "T", tbl_name: "T", sql: "CREATE TABLE T (v)" },
        { type: "index", name: "T_v", tbl_name: "T", sql: "CREATE INDEX T_v ON T(v)" },
        { type: "index", name: "sqlite_autoindex_T_1", tbl_name: "T", sql: null },
      ],
      tables: [{ name: "T", columns: ["v"], rows: [[{ $blob: "AQ==" }], [null], [3]] }],
    };
    expect(restoreStatements(current, backup)).toEqual([
      { sql: "PRAGMA defer_foreign_keys = on" },
      { sql: 'DROP TABLE IF EXISTS "Child"' },
      { sql: 'DROP TABLE IF EXISTS "Parent"' },
      { sql: "CREATE TABLE T (v)" },
      { sql: "CREATE INDEX T_v ON T(v)" },
      { sql: 'INSERT INTO "T" ("v") VALUES (?)', params: [new Uint8Array([1])] },
      { sql: 'INSERT INTO "T" ("v") VALUES (?)', params: [null] },
      { sql: 'INSERT INTO "T" ("v") VALUES (?)', params: [3] },
    ]);
  });
});

describe("the backups folder", () => {
  it("names a backup by its kind and UTC time", () => {
    expect(backupFileName("auto", new Date("2026-11-23T03:17:05.123Z"))).toBe("spoonjoy-auto-2026-11-23T03-17-05Z.tar.gz");
    expect(backupFileName("manual")).toMatch(/^spoonjoy-manual-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.tar\.gz$/);
  });

  it("lists the backups newest first and ignores anything else", () => {
    const folder = path.join(dir, "backups");
    mkdirSync(folder);
    for (const name of [
      "spoonjoy-auto-2026-11-21T03-17-00Z.tar.gz",
      "spoonjoy-manual-2026-11-22T10-00-00Z.tar.gz",
      "spoonjoy-before-restore-2026-11-22T10-00-00Z.tar.gz",
      "spoonjoy-auto-2026-11-22T10-00-00Z.tar.gz.partial",
      "notes.txt",
    ]) writeFileSync(path.join(folder, name), "xx");
    expect(listBackups(folder)).toEqual([
      { name: "spoonjoy-before-restore-2026-11-22T10-00-00Z.tar.gz", kind: "before-restore", size: 2, createdAt: "2026-11-22T10:00:00Z" },
      { name: "spoonjoy-manual-2026-11-22T10-00-00Z.tar.gz", kind: "manual", size: 2, createdAt: "2026-11-22T10:00:00Z" },
      { name: "spoonjoy-auto-2026-11-21T03-17-00Z.tar.gz", kind: "auto", size: 2, createdAt: "2026-11-21T03:17:00Z" },
    ]);
  });

  it("has no backups before its folder exists, and says when the folder isn't one", () => {
    expect(listBackups(path.join(dir, "none"))).toEqual([]);
    writeFileSync(path.join(dir, "file"), "x");
    expect(() => listBackups(path.join(dir, "file"))).toThrow("ENOTDIR");
  });

  it("deletes only the oldest scheduled backups beyond the number kept", () => {
    const folder = path.join(dir, "backups");
    mkdirSync(folder);
    const names = [
      "spoonjoy-auto-2026-11-20T03-17-00Z.tar.gz",
      "spoonjoy-auto-2026-11-21T03-17-00Z.tar.gz",
      "spoonjoy-auto-2026-11-22T03-17-00Z.tar.gz",
      "spoonjoy-manual-2026-11-19T10-00-00Z.tar.gz",
    ];
    for (const name of names) writeFileSync(path.join(folder, name), "x");
    expect(pruneBackups(folder, 2)).toEqual(["spoonjoy-auto-2026-11-20T03-17-00Z.tar.gz"]);
    expect(readdirSync(folder).sort()).toEqual(names.slice(1).sort());
    expect(pruneBackups(folder, 2)).toEqual([]);
    expect(readFileSync(path.join(folder, names[3]), "utf8")).toBe("x");
  });
});
