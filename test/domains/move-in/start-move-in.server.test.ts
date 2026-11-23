// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MOVE_IN_UPLOAD_MAX_BYTES, startMoveIn } from "~/domains/move-in/adapters/worker/start-move-in.server";
import { migratedSqliteD1, type MigratedSqlite } from "../../helpers/migrated-sqlite";
import { makeZip } from "./support/make-zip";
import { mealieDatabase } from "./support/mealie-database";

let database: MigratedSqlite;
const now = new Date("2026-11-23T12:00:00.000Z");

function memoryBucket() {
  const objects: Record<string, unknown> = {};
  return { objects, put: async (key: string, value: unknown) => void (objects[key] = value) };
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
  startMoveIn({ env: { DB: database.binding, PHOTOS: bucket } as never, ownerId: "chef-1", app: "mealie", file: { name, bytes }, now });

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
    expect(await start(zip())).toEqual({ ok: false, code: "pick-a-group" });
  });

  it("refuses a backup larger than it can take", async () => {
    expect(await start(new Uint8Array(MOVE_IN_UPLOAD_MAX_BYTES + 1))).toEqual({ ok: false, code: "backup-too-large" });
  });

  it("passes on an outage rather than calling it a bad backup", async () => {
    const down = { prepare: database.binding.prepare, batch: () => Promise.reject(new Error("D1 is down")) };
    await expect(startMoveIn({ env: { DB: down, PHOTOS: memoryBucket() } as never, ownerId: "chef-1", app: "mealie", file: { name: "x.zip", bytes: zip() }, now }))
      .rejects.toThrow("D1 is down");
  });

  it("refuses an app it can't read yet", async () => {
    const result = await startMoveIn({ env: { DB: database.binding, PHOTOS: memoryBucket() } as never, ownerId: "chef-1", app: "paprika", file: { name: "x.zip", bytes: zip() }, now });
    expect(result).toEqual({ ok: false, code: "unknown-app" });
  });
});
