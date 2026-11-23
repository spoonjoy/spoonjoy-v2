// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMoveInJob, moveInJobStore, readMoveInPosition } from "~/domains/move-in/adapters/storage/job-store.server";
import {
  MOVE_IN_HELD_SECONDS,
  MOVE_IN_JOB,
  MOVE_IN_QUIET_MS,
  MOVE_IN_WATCH,
  MOVE_IN_WATCH_SECONDS,
  moveInJobHandler,
  moveInJobKey,
  moveInWatchHandler,
  nudgeMoveIn,
  queueMoveIn,
  startMoveInJob,
} from "~/domains/move-in/adapters/worker/move-in-job.server";
import { jobRegistry, memoryJobs, type EnqueueOptions, type Jobs } from "~/domains/platform";

// A segment can stand in for the runner, to show what the handler does with a run that moved nothing.
const segment = vi.hoisted(() => ({ instead: null as null | ((jobId: string) => Promise<unknown>) }));
vi.mock("~/domains/move-in/application/run-move-in", async (original) => {
  const actual = await original<typeof import("~/domains/move-in/application/run-move-in")>();
  return {
    ...actual,
    runMoveInSegment: (...args: Parameters<typeof actual.runMoveInSegment>) =>
      segment.instead ? segment.instead(args[0]) : actual.runMoveInSegment(...args),
  };
});
import { migratedSqliteD1, type MigratedSqlite } from "../../helpers/migrated-sqlite";
import { makeZip } from "./support/make-zip";
import { mealieDatabase } from "./support/mealie-database";

let database: MigratedSqlite;
const now = new Date("2026-11-23T12:00:00.000Z");
const webp = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32]);
const archiveKey = "pending-uploads/move-in/chef-1/a.zip";

function memoryBucket(objects: Record<string, Uint8Array> = {}) {
  const bucket = {
    objects,
    /** Lookups left to fail, as storage does in an outage. */
    failures: 0,
    head: async (key: string) => {
      if (bucket.failures-- > 0) throw new Error("storage is down");
      return objects[key] ? { size: objects[key].length } : null;
    },
    get: async (key: string, options: { range: { offset: number; length: number } }) => {
      const bytes = objects[key];
      if (!bytes) return null;
      const { offset, length } = options.range;
      return { arrayBuffer: async () => bytes.slice(offset, offset + length).buffer };
    },
    put: async (key: string, value: Uint8Array) => void (objects[key] = value),
    delete: async (key: string) => void delete objects[key],
  };
  return bucket;
}

/** A jobs port that only records what it was asked to queue. */
function recordingJobs() {
  const queued: Array<{ type: string; payload: unknown; options: EnqueueOptions }> = [];
  const jobs: Jobs = {
    enqueue: async (kind, payload, options) => {
      queued.push({ type: kind.type, payload, options });
      return { enqueued: true };
    },
  };
  return { jobs, queued };
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
  return { bucket, env, jobId, jobs, store };
}

const job = (jobId: string) =>
  database.sqlite.prepare(`SELECT "status", "phase", "cursor", "claimToken" FROM "ImportJob" WHERE "id" = ?`).get(jobId);

beforeEach(() => {
  segment.instead = null;
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

  it("runs a small move-in in one segment, on the real clock, by default", async () => {
    const { env, jobId } = await setUp();
    const registry = jobRegistry();
    const jobs = memoryJobs(registry);
    registry.on(MOVE_IN_JOB, moveInJobHandler(env, jobs));
    await queueMoveIn(jobs, { id: jobId, phase: "inspect", cursor: null });
    expect((await jobs.drain()).map(({ outcome }) => outcome.status)).toEqual(["done"]);
    expect(job(jobId)).toMatchObject({ status: "done-with-issues" });
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

  it("looks again once a held move-in's claim could lapse, spending none of its attempts, and runs it then", async () => {
    const held: Array<{ payload: unknown; options: EnqueueOptions }> = [];
    const { jobId, jobs, store } = await setUp({
      jobs: (real) => ({
        enqueue: async (kind, payload, options) => {
          if (!options.key.includes(":held:")) return real.enqueue(kind, payload, options);
          held.push({ payload, options });
          return { enqueued: true };
        },
      }),
    });
    const token = (await store.claim(jobId, now)) as string;
    await queueMoveIn(jobs, { id: jobId, phase: "inspect", cursor: null });

    expect((await jobs.drain()).map(({ outcome }) => outcome.status)).toEqual(["done"]);
    const window = Math.floor(now.getTime() / 45_000);
    expect(held).toEqual([
      { payload: { jobId }, options: { key: `move-in:${jobId}:inspect:-:held:${window}`, delaySeconds: MOVE_IN_HELD_SECONDS } },
    ]);
    expect(MOVE_IN_HELD_SECONDS).toBe(50);
    expect(job(jobId)).toMatchObject({ status: "queued", claimToken: token });

    // By the time the look comes round, the other run has let go.
    await store.release(jobId, token);
    await jobs.enqueue(MOVE_IN_JOB, held[0].payload as { jobId: string }, held[0].options);
    expect((await jobs.drain()).at(-1)?.outcome.status).toBe("done");
    expect(job(jobId)).toMatchObject({ status: "done-with-issues" });
  });

  it("lets the move-in go when a segment stops with an error, so the retry runs it rather than finding it held", async () => {
    const { bucket, jobId, jobs } = await setUp();
    bucket.failures = 1;
    await queueMoveIn(jobs, { id: jobId, phase: "inspect", cursor: null });

    const ran = await jobs.drain();

    expect(ran[0]).toMatchObject({ key: `move-in:${jobId}:inspect:-`, outcome: { status: "retry" } });
    expect(ran.map(({ key }) => key).filter((key) => key.includes(":held:"))).toEqual([]);
    expect(job(jobId)).toMatchObject({ status: "done-with-issues", claimToken: null });
  });

  it("runs a segment that held the move-in and moved nothing again, through the port's retries", async () => {
    const { jobId, jobs, store } = await setUp();
    segment.instead = async (id) => ({ job: await store.loadJob(id), claimed: true });
    await queueMoveIn(jobs, { id: jobId, phase: "inspect", cursor: null });

    const ran = await jobs.drain();

    expect(ran.map(({ outcome }) => outcome.status)).toEqual(["retry", "retry", "retry", "retry", "failed"]);
    expect(ran.at(-1)?.outcome).toMatchObject({ status: "failed", error: { message: `A segment of ${jobId} moved nothing` } });
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

describe("readMoveInPosition", () => {
  it("reads where the job stands and when it was last written to, and null for no job", async () => {
    const { jobId } = await setUp();
    expect(await readMoveInPosition(database.binding, jobId)).toEqual({
      id: jobId,
      phase: "inspect",
      cursor: null,
      status: "queued",
      updatedAt: expect.any(String),
    });
    expect(await readMoveInPosition(database.binding, "movein_gone")).toBeNull();
  });
});

describe("startMoveInJob", () => {
  it("queues the first segment and the watch's first look", async () => {
    const { jobs, queued } = recordingJobs();
    await startMoveInJob(jobs, "movein_1");
    expect(queued).toEqual([
      { type: "move-in.run", payload: { jobId: "movein_1" }, options: { key: "move-in:movein_1:inspect:-" } },
      { type: "move-in.watch", payload: { jobId: "movein_1", look: 1 }, options: { key: "move-in:movein_1:watch:1", delaySeconds: 300 } },
    ]);
    expect(MOVE_IN_WATCH_SECONDS).toBe(300);
    expect(MOVE_IN_WATCH.type).toBe("move-in.watch");
  });
});

describe("the move-in watch", () => {
  const quiet = new Date(now.getTime() - MOVE_IN_QUIET_MS).toISOString();

  it("queues a move-in whose segments stopped coming, and looks again later", async () => {
    const { env, jobId } = await setUp();
    database.sqlite.prepare(`UPDATE "ImportJob" SET "status" = 'running', "phase" = 'recipes', "cursor" = '2', "updatedAt" = ?`).run(quiet);
    const { jobs, queued } = recordingJobs();

    await moveInWatchHandler(env, jobs, { now: () => now })({ jobId, look: 3 }, { key: "k", attempt: 1 });

    expect(queued).toEqual([
      { type: "move-in.run", payload: { jobId }, options: { key: `move-in:${jobId}:recipes:2` } },
      { type: "move-in.watch", payload: { jobId, look: 4 }, options: { key: `move-in:${jobId}:watch:4`, delaySeconds: 300 } },
    ]);
  });

  it("only looks again at a move-in that is moving, and stops at one that finished, is gone or isn't named", async () => {
    const { env, jobId } = await setUp();
    const { jobs, queued } = recordingJobs();
    const watch = moveInWatchHandler(env, jobs);
    const context = { key: "k", attempt: 1 };

    await watch({ jobId, look: 1 }, context);
    expect(queued.map(({ type }) => type)).toEqual(["move-in.watch"]);

    database.sqlite.prepare(`UPDATE "ImportJob" SET "status" = 'done', "phase" = 'done'`).run();
    await watch({ jobId, look: 2 }, context);
    await watch({ jobId: "movein_gone", look: 1 }, context);
    await watch({ jobId } as never, context);
    await watch(null as never, context);
    expect(queued).toHaveLength(1);
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
