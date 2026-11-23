// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MOVE_IN_UPLOAD_MAX_BYTES, startMoveIn } from "~/domains/move-in/adapters/worker/start-move-in.server";
import { migratedSqliteD1, type MigratedSqlite } from "../../helpers/migrated-sqlite";
import { makeZip } from "./support/make-zip";
import { mealieDatabase } from "./support/mealie-database";

let database: MigratedSqlite;
const now = new Date("2026-11-23T12:00:00.000Z");

/** An R2 bucket in memory: put (of bytes or a Blob), head, ranged get and delete. */
function memoryBucket() {
  const objects: Record<string, Uint8Array> = {};
  return {
    objects,
    put: async (key: string, value: Blob | Uint8Array) => void (objects[key] = value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : value),
    head: async (key: string) => (objects[key] ? { size: objects[key].length } : null),
    get: async (key: string, options: { range: { offset: number; length: number } }) => {
      const bytes = objects[key];
      if (!bytes) return null;
      const { offset, length } = options.range;
      return { arrayBuffer: async () => bytes.slice(offset, offset + length).buffer };
    },
    delete: async (key: string) => void delete objects[key],
  };
}

function zip(tables: unknown = mealieDatabase().tables) {
  return makeZip([{ name: "database.json", data: JSON.stringify(tables) }]);
}

beforeEach(() => {
  database = migratedSqliteD1();
  database.sqlite.prepare(`INSERT INTO "User" ("id", "email", "username") VALUES ('chef-1', 'cook@example.com', 'chef')`).run();
});

afterEach(() => database.close());

const start = (bytes: Uint8Array, bucket = memoryBucket(), name = "mealie_2026.11.23.zip") =>
  startMoveIn({ env: { DB: database.binding, PHOTOS: bucket } as never, ownerId: "chef-1", app: "mealie", file: { name, size: bytes.length, data: bytes }, now });

describe("startMoveIn", () => {
  it("keeps the backup where it is never served and queues its move-in", async () => {
    const bucket = memoryBucket();
    const result = await start(zip(), bucket);
    expect(result).toEqual({ ok: true, jobId: expect.stringMatching(/^movein_/) });
    const [key] = Object.keys(bucket.objects);
    expect(key).toMatch(/^pending-uploads\/move-in\/chef-1\/[0-9a-f-]{36}\.zip$/);
    const job = database.sqlite.prepare(`SELECT "ownerId", "kind", "status", "phase", "archiveKey", "archiveName" FROM "ImportJob"`).get();
    expect(job).toEqual({ ownerId: "chef-1", kind: "mealie-backup", status: "queued", phase: "inspect", archiveKey: key, archiveName: "mealie_2026.11.23.zip" });
  });

  it.each([
    ["a file that isn't a zip", new TextEncoder().encode("hello, this is not a zip at all"), "broken-zip"],
    ["a zip with no backup in it", makeZip([{ name: "notes.txt", data: "hi" }]), "not-a-backup"],
  ])("answers %s with its fix-it message, and stores nothing", async (_name, bytes, code) => {
    const bucket = memoryBucket();
    expect(await start(bytes, bucket)).toEqual({ ok: false, code });
    expect(bucket.objects).toEqual({});
    expect(database.sqlite.prepare(`SELECT COUNT(*) AS n FROM "ImportJob"`).get()).toEqual({ n: 0 });
  });

  it("says which email to use when the backup holds several kitchens and none is the person's", async () => {
    database.sqlite.prepare(`UPDATE "User" SET "email" = 'someone@example.com'`).run();
    const bucket = memoryBucket();
    expect(await start(zip(), bucket)).toEqual({ ok: false, code: "pick-a-group" });
    expect(bucket.objects).toEqual({});
  });

  it("takes the upload as the form's file, without copying it first", async () => {
    const bucket = memoryBucket();
    const data = new Blob([zip()]);
    expect(await startMoveIn({ env: { DB: database.binding, PHOTOS: bucket } as never, ownerId: "chef-1", app: "mealie", file: { name: "x.zip", size: data.size, data }, now }))
      .toEqual({ ok: true, jobId: expect.stringMatching(/^movein_/) });
    expect(Object.values(bucket.objects)).toEqual([zip()]);
  });

  it("refuses a backup larger than it can take", async () => {
    expect(await start(new Uint8Array(MOVE_IN_UPLOAD_MAX_BYTES + 1))).toEqual({ ok: false, code: "backup-too-large" });
  });

  it("passes on an outage rather than calling it a bad backup", async () => {
    const down = { prepare: database.binding.prepare, batch: () => Promise.reject(new Error("D1 is down")) };
    await expect(startMoveIn({ env: { DB: down, PHOTOS: memoryBucket() } as never, ownerId: "chef-1", app: "mealie", file: { name: "x.zip", size: 1, data: zip() }, now }))
      .rejects.toThrow("D1 is down");
  });

  it("still answers a bad backup when deleting it fails, and leaves it to the sweep", async () => {
    const bucket = { ...memoryBucket(), delete: async () => Promise.reject(new Error("R2 is down")) };
    expect(await start(new TextEncoder().encode("not a zip"), bucket)).toEqual({ ok: false, code: "broken-zip" });
  });

  it("still passes on a failed save when deleting the backup fails", async () => {
    const bucket = { ...memoryBucket(), delete: async () => Promise.reject(new Error("R2 is down")) };
    const failing = {
      prepare: database.binding.prepare,
      batch: (statements: Array<{ sql: string }>) =>
        statements.some((statement) => statement.sql.includes(`INSERT INTO "ImportJob"`)) ? Promise.reject(new Error("D1 is down")) : database.binding.batch(statements as never),
    };
    await expect(startMoveIn({ env: { DB: failing, PHOTOS: bucket } as never, ownerId: "chef-1", app: "mealie", file: { name: "x.zip", size: 1, data: zip() }, now }))
      .rejects.toThrow("D1 is down");
  });

  it("deletes the backup again when the job can't be saved", async () => {
    const bucket = memoryBucket();
    const failing = {
      prepare: database.binding.prepare,
      batch: (statements: Array<{ sql: string }>) =>
        statements.some((statement) => statement.sql.includes(`INSERT INTO "ImportJob"`)) ? Promise.reject(new Error("D1 is down")) : database.binding.batch(statements as never),
    };
    await expect(startMoveIn({ env: { DB: failing, PHOTOS: bucket } as never, ownerId: "chef-1", app: "mealie", file: { name: "x.zip", size: 1, data: zip() }, now }))
      .rejects.toThrow("D1 is down");
    expect(bucket.objects).toEqual({});
  });

  it("refuses an app it can't read yet", async () => {
    const result = await startMoveIn({ env: { DB: database.binding, PHOTOS: memoryBucket() } as never, ownerId: "chef-1", app: "paprika", file: { name: "x.zip", size: 1, data: zip() }, now });
    expect(result).toEqual({ ok: false, code: "unknown-app" });
  });
});
