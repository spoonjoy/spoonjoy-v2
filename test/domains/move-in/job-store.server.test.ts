// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMoveInJob, moveInJobStore, readMoveInProgress } from "~/domains/move-in/adapters/storage/job-store.server";
import type { MoveInEvent } from "~/domains/move-in/application/run-move-in";
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
      id, ownerId: "chef-1", kind: "mealie-backup", sourceId: null, status: "queued", phase: "inspect", cursor: null, archiveKey: "move-in/chef-1/a.zip", lastError: null,
    });
    expect(await moveInJobStore(database.binding, () => clock).loadJob("nope")).toBeNull();
  });

  it("saves the job's progress and stamps when it started and finished", async () => {
    const store = moveInJobStore(database.binding, () => clock);
    const id = await create();
    later(5);
    await store.updateJob(id, { status: "running" });
    expect(row(id)).toMatchObject({ status: "running", startedAt: "2026-11-23T12:00:05.000Z", finishedAt: null, heartbeatAt: "2026-11-23T12:00:05.000Z" });
    later(5);
    await store.updateJob(id, { cursor: "10", phase: "recipes" });
    expect(row(id)).toMatchObject({ startedAt: "2026-11-23T12:00:05.000Z", heartbeatAt: "2026-11-23T12:00:10.000Z" });
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
    await store.addCounts(id, "recipes", { found: 3 });
    await store.addCounts(id, "recipes", { created: 1, skipped: 1 });
    await store.addEvent(id, info("Found 3 recipes."));
    expect(await store.hasIssues(id)).toBe(false);
    await store.addEvent(id, { ...info("Pancakes (2)"), level: "warn", kind: "item-degraded", entity: "recipes", sourceKey: "r1", targetId: "x" });
    expect(await store.hasIssues(id)).toBe(true);

    const progress = await readMoveInProgress(database.binding, { ownerId: "chef-1", jobId: id });
    expect(progress?.counts).toEqual({ recipes: { found: 3, created: 1, updated: 0, unchanged: 0, skipped: 1, failed: 0 } });
    expect(progress?.events.map((event) => [event.seq, event.level, event.message])).toEqual([[1, "info", "Found 3 recipes."], [2, "warn", "Pancakes (2)"]]);
    expect(progress?.job).toMatchObject({ id, status: "queued", archiveName: "backup.zip" });
  });

  it("shows a job only to its owner", async () => {
    const id = await create();
    expect(await readMoveInProgress(database.binding, { ownerId: "chef-2", jobId: id })).toBeNull();
  });
});
