// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMoveInJob, moveInJobStore, readMoveInProgress } from "~/domains/move-in/adapters/storage/job-store.server";
import {
  MOVE_IN_ABANDONED_MS,
  MOVE_IN_UPLOAD_GRACE_MS,
  runScheduledMoveInSweep,
  sweepMoveInArchives,
} from "~/domains/move-in/adapters/worker/sweep-move-in-archives.server";
import { migratedSqliteD1, type MigratedSqlite } from "../../helpers/migrated-sqlite";

let database: MigratedSqlite;
const start = new Date("2026-11-23T12:00:00.000Z");
const at = (ms: number) => new Date(start.getTime() + ms);

/** An R2 bucket in memory that lists by prefix, a page at a time, and deletes. */
function memoryBucket(objects: Record<string, Date>) {
  const listed: Array<string | undefined> = [];
  return {
    objects,
    listed,
    async list({ prefix, cursor, limit }: { prefix: string; cursor?: string; limit?: number }) {
      listed.push(prefix);
      const keys = Object.keys(objects).filter((key) => key.startsWith(prefix)).sort();
      const from = cursor ? Number(cursor) : 0;
      const page = keys.slice(from, from + (limit ?? 1000));
      const next = from + page.length;
      return {
        objects: page.map((key) => ({ key, uploaded: objects[key] })),
        truncated: next < keys.length,
        cursor: next < keys.length ? String(next) : undefined,
      };
    },
    delete: async (keys: string | string[]) => {
      for (const key of [keys].flat()) delete objects[key];
    },
  };
}

const job = (archiveKey: string) =>
  createMoveInJob(database.binding, { ownerId: "chef-1", kind: "mealie-backup", archiveKey, archiveName: "backup.zip", now: start });

beforeEach(() => {
  database = migratedSqliteD1();
  database.sqlite.prepare(`INSERT INTO "User" ("id", "email", "username") VALUES ('chef-1', 'cook@example.com', 'chef')`).run();
});

afterEach(() => database.close());

describe("sweepMoveInArchives", () => {
  it("deletes the backup of a job that finished, and keeps one still moving in", async () => {
    const done = await job("pending-uploads/move-in/chef-1/done.zip");
    await moveInJobStore(database.binding, () => start).updateJob(done, { status: "done", phase: "done" });
    await job("pending-uploads/move-in/chef-1/live.zip");
    const bucket = memoryBucket({ "pending-uploads/move-in/chef-1/done.zip": start, "pending-uploads/move-in/chef-1/live.zip": start });
    expect(await sweepMoveInArchives({ db: database.binding, bucket, now: at(60_000) })).toEqual({ deleted: 1, expired: 0 });
    expect(Object.keys(bucket.objects)).toEqual(["pending-uploads/move-in/chef-1/live.zip"]);
    expect(bucket.listed).toEqual(["pending-uploads/move-in/"]);
  });

  it("deletes a backup with no job once an upload has had time to create its job", async () => {
    const bucket = memoryBucket({ "pending-uploads/move-in/gone/a.zip": start });
    expect(await sweepMoveInArchives({ db: database.binding, bucket, now: at(MOVE_IN_UPLOAD_GRACE_MS - 1) })).toEqual({ deleted: 0, expired: 0 });
    expect(await sweepMoveInArchives({ db: database.binding, bucket, now: at(MOVE_IN_UPLOAD_GRACE_MS) })).toEqual({ deleted: 1, expired: 0 });
    expect(bucket.objects).toEqual({});
  });

  it("ends a job that stopped moving forward, says why, and deletes its backup", async () => {
    const id = await job("pending-uploads/move-in/chef-1/old.zip");
    const bucket = memoryBucket({ "pending-uploads/move-in/chef-1/old.zip": start });
    expect(await sweepMoveInArchives({ db: database.binding, bucket, now: at(MOVE_IN_ABANDONED_MS - 1) })).toEqual({ deleted: 0, expired: 0 });
    expect(await sweepMoveInArchives({ db: database.binding, bucket, now: at(MOVE_IN_ABANDONED_MS) })).toEqual({ deleted: 1, expired: 1 });
    const progress = await readMoveInProgress(database.binding, { ownerId: "chef-1", jobId: id });
    expect(progress?.job).toMatchObject({ status: "failed", lastError: "expired" });
    expect(progress?.events.at(-1)).toMatchObject({ kind: "job-failed", level: "error", message: expect.stringMatching(/^This move-in went a day/) });
  });

  it("leaves a quiet job alone while a run has just taken it", async () => {
    const id = await job("pending-uploads/move-in/chef-1/back.zip");
    await moveInJobStore(database.binding, () => start).claim(id, at(MOVE_IN_ABANDONED_MS - 1000));
    const bucket = memoryBucket({ "pending-uploads/move-in/chef-1/back.zip": start });
    expect(await sweepMoveInArchives({ db: database.binding, bucket, now: at(MOVE_IN_ABANDONED_MS) })).toEqual({ deleted: 0, expired: 0 });
  });

  it("reads every page of a long listing", async () => {
    const objects = Object.fromEntries(Array.from({ length: 3 }, (_, i) => [`pending-uploads/move-in/gone/${i}.zip`, start]));
    const bucket = memoryBucket(objects);
    const list = bucket.list;
    bucket.list = (options) => list({ ...options, limit: 2 });
    expect(await sweepMoveInArchives({ db: database.binding, bucket, now: at(MOVE_IN_UPLOAD_GRACE_MS) })).toEqual({ deleted: 3, expired: 0 });
  });
});

describe("runScheduledMoveInSweep", () => {
  it("sweeps on the cron and logs what it did", async () => {
    const bucket = memoryBucket({ "pending-uploads/move-in/gone/a.zip": start });
    const lines: string[] = [];
    const report = await runScheduledMoveInSweep({ DB: database.binding, PHOTOS: bucket }, at(MOVE_IN_UPLOAD_GRACE_MS), (line) => lines.push(line));
    expect(report).toEqual({ deleted: 1, expired: 0 });
    expect(lines).toEqual([JSON.stringify({ event: "move_in_archive_sweep", deleted: 1, expired: 0 })]);
  });

  it("does nothing where the Worker has no database or bucket", async () => {
    expect(await runScheduledMoveInSweep({}, start)).toBeNull();
  });
});
