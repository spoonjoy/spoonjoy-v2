// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMoveInJob, moveInJobStore } from "~/domains/move-in/adapters/storage/job-store.server";
import {
  MOVE_IN_JOB,
  MOVE_IN_QUIET_MS,
  moveInJobHandler,
  moveInJobKey,
  nudgeMoveIn,
  queueMoveIn,
} from "~/domains/move-in/adapters/worker/move-in-job.server";
import { jobRegistry, memoryJobs, type Jobs } from "~/domains/platform";
import { migratedSqliteD1, type MigratedSqlite } from "../../helpers/migrated-sqlite";
import { makeZip } from "./support/make-zip";
import { mealieDatabase } from "./support/mealie-database";

let database: MigratedSqlite;
const now = new Date("2026-11-23T12:00:00.000Z");
const webp = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32]);
const archiveKey = "pending-uploads/move-in/chef-1/a.zip";

function memoryBucket(objects: Record<string, Uint8Array> = {}) {
  return {
    objects,
    head: async (key: string) => (objects[key] ? { size: objects[key].length } : null),
    get: async (key: string, options: { range: { offset: number; length: number } }) => {
      const bytes = objects[key];
      if (!bytes) return null;
      const { offset, length } = options.range;
      return { arrayBuffer: async () => bytes.slice(offset, offset + length).buffer };
    },
    put: async (key: string, value: Uint8Array) => void (objects[key] = value),
    delete: async (key: string) => void delete objects[key],
  };
}

function backup() {
  const { tables, keys } = mealieDatabase();
  return makeZip([
    { name: "database.json", data: JSON.stringify(tables) },
    { name: `data/recipes/${keys.pancakes}/images/original.webp`, data: webp, store: true },
  ]);
}

/** A move-in waiting to run, its bucket, and the jobs port that runs its segments in memory. */
async function setUp({ jobs: wrap = (jobs: Jobs) => jobs }: { jobs?: (jobs: Jobs) => Jobs } = {}) {
  const bucket = memoryBucket({ [archiveKey]: backup() });
  const env = { DB: database.binding, PHOTOS: bucket } as never;
  const jobId = await createMoveInJob(database.binding, { ownerId: "chef-1", kind: "mealie-backup", archiveKey, archiveName: "a.zip", now });
  const registry = jobRegistry();
  const jobs = memoryJobs(registry);
  // A budget of 0 stops each segment after one chunk of one recipe, so the move-in takes several.
  registry.on(MOVE_IN_JOB, moveInJobHandler(env, wrap(jobs), { budgetMs: 0, chunkSize: 1, now: () => now }));
  const store = moveInJobStore(database.binding, () => now);
  return { bucket, jobId, jobs, store };
}

const job = (jobId: string) =>
  database.sqlite.prepare(`SELECT "status", "phase", "cursor", "claimToken" FROM "ImportJob" WHERE "id" = ?`).get(jobId);

beforeEach(() => {
  database = migratedSqliteD1();
  database.sqlite.prepare(`INSERT INTO "User" ("id", "email", "username") VALUES ('chef-1', 'cook@example.com', 'chef')`).run();
});

afterEach(() => database.close());

describe("moveInJobKey", () => {
  it("names the job and where it stands, so each segment is queued once", () => {
    expect(moveInJobKey({ id: "movein_1", phase: "inspect", cursor: null })).toBe("move-in:movein_1:inspect:-");
    expect(moveInJobKey({ id: "movein_1", phase: "recipes", cursor: "20" })).toBe("move-in:movein_1:recipes:20");
  });
});

describe("the move-in job", () => {
  it("moves a backup in as queued segments, each picking up where the last stopped", async () => {
    const { bucket, jobId, jobs } = await setUp();
    expect(await queueMoveIn(jobs, { id: jobId, phase: "inspect", cursor: null })).toBe(true);

    const ran = await jobs.drain();

    expect(ran.map(({ key, outcome }) => [key, outcome.status])).toEqual([
      [`move-in:${jobId}:inspect:-`, "done"],
      [`move-in:${jobId}:recipes:0`, "done"],
      [`move-in:${jobId}:recipes:1`, "done"],
      [`move-in:${jobId}:recipes:2`, "done"],
    ]);
    expect(job(jobId)).toEqual({ status: "done-with-issues", phase: "done", cursor: null, claimToken: null });
    expect(database.sqlite.prepare(`SELECT COUNT(*) AS n FROM "Recipe" WHERE "chefId" = 'chef-1'`).get()).toEqual({ n: 3 });
    expect(Object.keys(bucket.objects)).not.toContain(archiveKey);
  });

  it("leaves alone a job that is finished, gone or not a move-in", async () => {
    const { jobId, jobs } = await setUp();
    database.sqlite.prepare(`UPDATE "ImportJob" SET "status" = 'done', "phase" = 'done'`).run();
    await queueMoveIn(jobs, { id: jobId, phase: "inspect", cursor: null });
    await jobs.enqueue(MOVE_IN_JOB, { jobId: "movein_gone" }, { key: "gone" });
    await jobs.enqueue(MOVE_IN_JOB, { jobId: 7 } as never, { key: "malformed" });
    await jobs.enqueue(MOVE_IN_JOB, null as never, { key: "empty" });

    const ran = await jobs.drain();

    expect(ran.map(({ outcome }) => outcome.status)).toEqual(["done", "done", "done", "done"]);
    expect(job(jobId)).toMatchObject({ status: "done", claimToken: null });
  });

  it("comes back later while another run holds the move-in, and can be queued again once it lets go", async () => {
    const { jobId, jobs, store } = await setUp();
    const token = (await store.claim(jobId, now)) as string;
    await queueMoveIn(jobs, { id: jobId, phase: "inspect", cursor: null });

    // In memory a retry runs at once, so every attempt finds the claim still held, and the key is freed.
    const held = await jobs.drain();
    expect(held.map(({ outcome }) => outcome.status)).toEqual(["retry", "retry", "retry", "retry", "failed"]);
    expect(job(jobId)).toMatchObject({ status: "queued", claimToken: token });

    await store.release(jobId, token);
    expect(await queueMoveIn(jobs, { id: jobId, phase: "inspect", cursor: null })).toBe(true);
    expect((await jobs.drain()).at(-1)?.outcome.status).toBe("done");
    expect(job(jobId)).toMatchObject({ status: "done-with-issues" });
  });

  it("queues the next segment again when the first try to queue it fails", async () => {
    let failures = 1;
    const { jobId, jobs } = await setUp({
      jobs: (real) => ({
        enqueue: async (...args) => {
          if (failures-- > 0) throw new Error("the queue is down");
          return real.enqueue(...args);
        },
      }),
    });
    await queueMoveIn(jobs, { id: jobId, phase: "inspect", cursor: null });

    const ran = await jobs.drain();

    expect(ran[0]).toMatchObject({ key: `move-in:${jobId}:inspect:-`, outcome: { status: "retry" } });
    // The retry finds inspect done, runs the next chunk, and queues from there.
    expect(ran[1]).toMatchObject({ key: `move-in:${jobId}:inspect:-`, outcome: { status: "done" } });
    expect(ran.at(-1)?.outcome.status).toBe("done");
    expect(job(jobId)).toMatchObject({ status: "done-with-issues" });
  });
});

describe("nudgeMoveIn", () => {
  const quietFor = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it("queues a move-in nothing has moved for a while, and leaves a moving or finished one alone", async () => {
    const { jobs } = await setUp();
    const at = { id: "movein_1", phase: "recipes", cursor: "4", status: "running" } as const;

    expect(await nudgeMoveIn(jobs, { ...at, updatedAt: quietFor(MOVE_IN_QUIET_MS - 1) }, now)).toBe(false);
    expect(await nudgeMoveIn(jobs, { ...at, status: "done", updatedAt: quietFor(MOVE_IN_QUIET_MS) }, now)).toBe(false);
    expect(await nudgeMoveIn(jobs, { ...at, updatedAt: quietFor(MOVE_IN_QUIET_MS) }, now)).toBe(true);
    // Its segment is waiting now, so it is not queued twice.
    expect(await nudgeMoveIn(jobs, { ...at, updatedAt: quietFor(MOVE_IN_QUIET_MS) }, now)).toBe(false);
    expect(MOVE_IN_QUIET_MS).toBe(60_000);
  });
});
