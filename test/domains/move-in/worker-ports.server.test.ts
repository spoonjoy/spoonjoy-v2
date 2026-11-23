// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMoveInJob } from "~/domains/move-in/adapters/storage/job-store.server";
import { moveInPorts, r2RangeSource } from "~/domains/move-in/adapters/worker/move-in-ports.server";
import { runForAWhile } from "~/domains/move-in/application/run-move-in";
import { MoveInError } from "~/domains/move-in/model/move-in-error";
import { migratedSqliteD1, type MigratedSqlite } from "../../helpers/migrated-sqlite";
import { makeZip } from "./support/make-zip";
import { mealieDatabase } from "./support/mealie-database";

let database: MigratedSqlite;
const now = new Date("2026-11-23T12:00:00.000Z");
const webp = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32]);

/** An R2 bucket in memory that answers head, ranged get and put. */
function memoryBucket(objects: Record<string, Uint8Array> = {}) {
  const reads: Array<{ offset: number; length: number }> = [];
  return {
    objects,
    reads,
    head: async (key: string) => (objects[key] ? { size: objects[key].length } : null),
    get: async (key: string, options: { range: { offset: number; length: number } }) => {
      const bytes = objects[key];
      if (!bytes) return null;
      reads.push(options.range);
      const { offset, length } = options.range;
      return { arrayBuffer: async () => bytes.slice(offset, offset + length).buffer };
    },
    put: async (key: string, value: Uint8Array) => {
      objects[key] = value;
      return null;
    },
    delete: async (key: string) => void delete objects[key],
  };
}

beforeEach(() => {
  database = migratedSqliteD1();
  database.sqlite.prepare(`INSERT INTO "User" ("id", "email", "username") VALUES ('chef-1', 'cook@example.com', 'chef')`).run();
});

afterEach(() => database.close());

describe("r2RangeSource", () => {
  it("reads only the ranges asked for", async () => {
    const bucket = memoryBucket({ "a.zip": new Uint8Array([1, 2, 3, 4, 5]) });
    const source = await r2RangeSource(bucket as never, "a.zip");
    expect(source.size).toBe(5);
    expect([...(await source.read(1, 2))]).toEqual([2, 3]);
    expect(bucket.reads).toEqual([{ offset: 1, length: 2 }]);
  });

  it("asks for the backup again when the upload is gone", async () => {
    const bucket = memoryBucket();
    await expect(r2RangeSource(bucket as never, "gone.zip")).rejects.toBeInstanceOf(MoveInError);
    bucket.objects["late.zip"] = new Uint8Array(4);
    const source = await r2RangeSource(bucket as never, "late.zip");
    delete bucket.objects["late.zip"];
    await expect(source.read(0, 1)).rejects.toMatchObject({ code: "broken-zip" });
  });
});

describe("moveInPorts", () => {
  it("moves a backup in from R2 into D1, with the photo as the recipe's cover", async () => {
    const { tables, keys } = mealieDatabase();
    const zip = makeZip([
      { name: "database.json", data: JSON.stringify(tables) },
      { name: `data/recipes/${keys.pancakes}/images/original.webp`, data: webp, store: true },
    ]);
    const archiveKey = "pending-uploads/move-in/chef-1/a.zip";
    const photos = memoryBucket({ [archiveKey]: zip });
    const jobId = await createMoveInJob(database.binding, { ownerId: "chef-1", kind: "mealie-backup", archiveKey, archiveName: "backup.zip", now });
    const ports = moveInPorts({ DB: database.binding, PHOTOS: photos } as never, () => now);
    expect(await ports.ownerEmail("chef-1")).toBe("cook@example.com");
    expect(await ports.ownerEmail("nobody")).toBeNull();

    expect(await runForAWhile(jobId, ports, { budgetMs: 1000 })).toMatchObject({ status: "done-with-issues" });
    const recipes = database.sqlite.prepare(`SELECT "title", "activeCoverId" IS NOT NULL AS "hasCover" FROM "Recipe" ORDER BY "title"`).all();
    expect(recipes).toEqual([
      { title: "Pancakes", hasCover: 1 },
      { title: "Soup", hasCover: 0 },
      { title: "Untitled recipe", hasCover: 0 },
    ]);
    // The backup is deleted once it has moved in; the cover photo stays.
    expect(Object.keys(photos.objects)).toEqual([expect.stringMatching(/^covers\/import\/movein-/)]);
  });
});
