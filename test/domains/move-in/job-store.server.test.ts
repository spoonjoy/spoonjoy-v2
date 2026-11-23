// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMoveInJob, moveInJobStore, readMoveInProgress } from "~/domains/move-in/adapters/storage/job-store.server";
import { LostClaimError, type MoveInEvent } from "~/domains/move-in/application/run-move-in";
import { migratedSqliteD1, type MigratedSqlite } from "../../helpers/migrated-sqlite";

let database: MigratedSqlite;
let clock = new Date("2026-11-23T12:00:00.000Z");
const later = (seconds: number) => (clock = new Date(clock.getTime() + seconds * 1000));
const info = (message: string): MoveInEvent => ({ level: "info", kind: "phase-done", entity: null, sourceKey: null, targetId: null, message });

function row(id: string) {
  return database.sqlite.prepare(`SELECT "status", "startedAt", "finishedAt", "heartbeatAt", "updatedAt", "archiveName" FROM "ImportJob" WHERE "id" = ?`).get(id);
}

beforeEach(() => {
  clock = new Date("2026-11-23T12:00:00.000Z");
  database = migratedSqliteD1();
  for (const id of ["chef-1", "chef-2"]) {
    database.sqlite.prepare(`INSERT INTO "User" ("id", "email", "username") VALUES (?, ?, ?)`).run(id, `${id}@example.com`, id);
  }
});

afterEach(() => database.close());

const create = () =>
  createMoveInJob(database.binding, { ownerId: "chef-1", kind: "mealie-backup", archiveKey: "move-in/chef-1/a.zip", archiveName: "backup.zip", now: clock });

describe("the move-in job store", () => {
  it("creates a queued job that starts by inspecting its archive", async () => {
    const id = await create();
    expect(await moveInJobStore(database.binding, () => clock).loadJob(id)).toEqual({
      id, ownerId: "chef-1", kind: "mealie-backup", sourceId: null, status: "queued", phase: "inspect", cursor: null, archiveKey: "move-in/chef-1/a.zip", lastError: null, attempt: 0,
    });
    expect(await moveInJobStore(database.binding, () => clock).loadJob("nope")).toBeNull();
  });

  it("saves the job's progress and stamps when it started and finished", async () => {
    const store = moveInJobStore(database.binding, () => clock);
    const id = await create();
    later(5);
    await store.updateJob(id, { status: "running" });
    expect(row(id)).toMatchObject({ status: "running", startedAt: "2026-11-23T12:00:05.000Z", finishedAt: null, heartbeatAt: null });
    later(5);
    await store.updateJob(id, { cursor: "10", phase: "recipes" });
    expect(row(id)).toMatchObject({ startedAt: "2026-11-23T12:00:05.000Z", updatedAt: "2026-11-23T12:00:10.000Z" });
    later(5);
    await store.updateJob(id, { status: "done", phase: "done", cursor: null });
    expect(row(id)).toMatchObject({ status: "done", finishedAt: "2026-11-23T12:00:15.000Z", updatedAt: "2026-11-23T12:00:15.000Z" });
    expect(await store.loadJob(id)).toMatchObject({ phase: "done", cursor: null });
  });

  it("keeps one source per owner, app and kitchen", async () => {
    const store = moveInJobStore(database.binding, () => clock);
    const source = { ownerId: "chef-1", kind: "mealie-backup", instanceKey: "group-1", label: "Home", sourceVersion: "v2.8.0" };
    const first = await store.ensureSource(source);
    expect(await store.ensureSource({ ...source, label: "Our home", sourceVersion: "v3.31.0" })).toBe(first);
    expect(await store.ensureSource({ ...source, ownerId: "chef-2" })).not.toBe(first);
    expect(database.sqlite.prepare(`SELECT "label", "sourceVersion" FROM "ImportSource" WHERE "id" = ?`).get(first)).toEqual({ label: "Our home", sourceVersion: "v3.31.0" });
  });

  it("adds to the counts and numbers the report's lines in order", async () => {
    const store = moveInJobStore(database.binding, () => clock);
    const id = await create();
    await store.updateJob(id, {}, undefined, { counts: [["recipes", { found: 3 }]], events: [info("Found 3 recipes.")] });
    await store.updateJob(id, {}, undefined, { counts: [["recipes", { created: 1, skipped: 1 }]] });
    expect(await store.hasIssues(id)).toBe(false);
    await store.updateJob(id, {}, undefined, { events: [{ ...info("Pancakes (2)"), level: "warn", kind: "item-degraded", entity: "recipes", sourceKey: "r1", targetId: "x" }] });
    expect(await store.hasIssues(id)).toBe(true);

    const progress = await readMoveInProgress(database.binding, { ownerId: "chef-1", jobId: id });
    expect(progress?.counts).toEqual({ recipes: { found: 3, created: 1, updated: 0, unchanged: 0, skipped: 1, failed: 0 } });
    expect(progress?.events.map((event) => [event.seq, event.level, event.message])).toEqual([[1, "info", "Found 3 recipes."], [2, "warn", "Pancakes (2)"]]);
    expect(progress?.job).toMatchObject({ id, status: "queued", archiveName: "backup.zip" });
    expect(progress?.job).not.toHaveProperty("archiveKey");
  });

  it("lets one run work on a job at a time, and another take over a run that went quiet", async () => {
    const store = moveInJobStore(database.binding, () => clock);
    const id = await create();
    const first = await store.claim(id, clock);
    expect(first).toEqual(expect.any(String));
    expect(await store.claim(id, later(30))).toBeNull();
    await store.updateJob(id, { cursor: "1" }, first as string);
    expect(await store.claim(id, later(44))).toBeNull();
    const second = await store.claim(id, later(2));
    expect(second).toEqual(expect.any(String));
    expect(second).not.toBe(first);
    await store.release(id, first as string);
    expect(await store.claim(id, clock)).toBeNull();
    await store.release(id, second as string);
    expect(await store.claim(id, clock)).toEqual(expect.any(String));
  });

  it("refuses every write of a run that lost its claim, counts and report included", async () => {
    const store = moveInJobStore(database.binding, () => clock);
    const id = await create();
    const first = (await store.claim(id, clock)) as string;
    later(50);
    await store.claim(id, clock);
    const report = { counts: [["recipes", { created: 1 }]] as Array<[string, { created: number }]>, events: [info("Pancakes moved in.")] };
    await expect(store.updateJob(id, { cursor: "9" }, first, report)).rejects.toBeInstanceOf(LostClaimError);
    expect(await store.loadJob(id)).toMatchObject({ cursor: null });
    expect(await readMoveInProgress(database.binding, { ownerId: "chef-1", jobId: id })).toMatchObject({ counts: {}, events: [] });
  });

  it("counts each claim as an attempt", async () => {
    const store = moveInJobStore(database.binding, () => clock);
    const id = await create();
    await store.claim(id, clock);
    await store.claim(id, later(50));
    expect(await store.loadJob(id)).toMatchObject({ attempt: 2 });
  });

  it("changes a job only once it has gone quiet, when asked to, and says whether it did", async () => {
    const store = moveInJobStore(database.binding, () => clock);
    const id = await create();
    await store.claim(id, later(60));
    expect(await store.updateJob(id, { status: "failed" }, undefined, { quietSince: new Date(clock.getTime() - 1).toISOString() })).toBe(0);
    expect(await store.loadJob(id)).toMatchObject({ status: "queued" });
    expect(await store.updateJob(id, { status: "failed" }, undefined, { quietSince: later(60).toISOString() })).toBe(1);
  });

  it("never changes a finished job", async () => {
    const store = moveInJobStore(database.binding, () => clock);
    const id = await create();
    await store.updateJob(id, { status: "failed", lastError: "expired" });
    const token = (await store.claim(id, later(60))) as string;
    await expect(store.updateJob(id, { status: "done" }, token, { events: [info("late")] })).rejects.toBeInstanceOf(LostClaimError);
    await store.updateJob(id, { status: "done" });
    expect(await readMoveInProgress(database.binding, { ownerId: "chef-1", jobId: id })).toMatchObject({ job: { status: "failed" }, events: [] });
  });

  it("starts the counts over, and remembers the kitchen a source is", async () => {
    const store = moveInJobStore(database.binding, () => clock);
    const id = await create();
    await store.updateJob(id, {}, undefined, { counts: [["recipes", { found: 3 }]], events: [info("Found 3 recipes.")] });
    await store.updateJob(id, {}, undefined, { restart: true, counts: [["recipes", { found: 3 }]], events: [info("Found 3 recipes.")] });
    const progress = await readMoveInProgress(database.binding, { ownerId: "chef-1", jobId: id });
    expect(progress?.counts.recipes).toMatchObject({ found: 3 });
    expect(progress?.events.map((event) => event.message)).toEqual(["Found 3 recipes."]);
    const source = await store.ensureSource({ ownerId: "chef-1", kind: "mealie-backup", instanceKey: "group-1", label: "Home", sourceVersion: "v2.8.0" });
    expect(await store.sourceInstanceKey(source)).toBe("group-1");
    expect(await store.sourceInstanceKey("nope")).toBeNull();
  });

  it("keeps what the system said apart from the report's message", async () => {
    const store = moveInJobStore(database.binding, () => clock);
    const id = await create();
    await store.updateJob(id, {}, undefined, { events: [{ ...info("Soup didn't move in this time."), level: "error", kind: "item-failed", detail: "D1 said no" }] });
    const progress = await readMoveInProgress(database.binding, { ownerId: "chef-1", jobId: id });
    expect(progress?.events[0]).not.toHaveProperty("detail");
    expect(database.sqlite.prepare(`SELECT "detail" FROM "ImportEvent"`).get()).toEqual({ detail: "D1 said no" });
  });

  it("shows a job only to its owner", async () => {
    const id = await create();
    expect(await readMoveInProgress(database.binding, { ownerId: "chef-2", jobId: id })).toBeNull();
  });

  it("lists the newest recipes a move-in brought, with their photos, and only that move-in's own", async () => {
    const id = await create();
    const other = await create();
    const sql = database.sqlite;
    sql.prepare(`INSERT INTO "ImportSource" ("id", "ownerId", "kind", "instanceKey", "label") VALUES ('src-1', 'chef-1', 'mealie-backup', 'k', 'Kitchen')`).run();
    sql.prepare(`UPDATE "ImportJob" SET "sourceId" = 'src-1' WHERE "id" IN (?, ?)`).run(id, other);
    const recipe = (recipeId: string, title: string, minute: number, { job = id, chef = "chef-1", deleted = false, photo = false } = {}) => {
      sql.prepare(`INSERT INTO "Recipe" ("id", "title", "chefId", "deletedAt", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)`)
        .run(recipeId, title, chef, deleted ? "2026-11-23T13:00:00.000Z" : null, `2026-11-23T12:0${minute}:00.000Z`, `2026-11-23T12:0${minute}:00.000Z`);
      sql.prepare(`INSERT INTO "SourceRecord" ("id", "sourceId", "sourceTable", "sourceKey", "targetType", "targetId", "lastJobId") VALUES (?, 'src-1', 'recipes', ?, 'Recipe', ?, ?)`)
        .run(`rec-${recipeId}`, recipeId, recipeId, job);
      if (photo) {
        sql.prepare(`INSERT INTO "RecipeCover" ("id", "recipeId", "imageUrl", "sourceType") VALUES (?, ?, ?, 'import')`).run(`cover-${recipeId}`, recipeId, `/photos/covers/import/movein-${recipeId}.webp`);
        sql.prepare(`UPDATE "Recipe" SET "activeCoverId" = ? WHERE "id" = ?`).run(`cover-${recipeId}`, recipeId);
      }
    };
    for (let n = 1; n <= 6; n++) recipe(`r${n}`, `Recipe ${n}`, n, { photo: n % 2 === 0 });
    recipe("gone", "Deleted", 7, { deleted: true });
    recipe("theirs", "Another move-in's", 8, { job: other });

    const progress = await readMoveInProgress(database.binding, { ownerId: "chef-1", jobId: id });
    expect(progress?.latest).toEqual([
      { id: "r6", title: "Recipe 6", photoUrl: "/photos/covers/import/movein-r6.webp" },
      { id: "r5", title: "Recipe 5", photoUrl: null },
      { id: "r4", title: "Recipe 4", photoUrl: "/photos/covers/import/movein-r4.webp" },
      { id: "r3", title: "Recipe 3", photoUrl: null },
      { id: "r2", title: "Recipe 2", photoUrl: "/photos/covers/import/movein-r2.webp" },
    ]);
    expect((await readMoveInProgress(database.binding, { ownerId: "chef-1", jobId: await create() }))?.latest).toEqual([]);
  });
});
