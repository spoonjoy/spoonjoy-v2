// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMoveInJob, moveInJobStore, readMoveInPosition } from "~/domains/move-in/adapters/storage/job-store.server";
import {
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
import { jobRegistry, type EnqueueOptions, type Jobs } from "~/domains/platform";
import { memoryJobs } from "~/domains/platform/index.server";

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
  registry.on(MOVE_IN_JOB, moveInJobHandler(env, wrap(jobs), { budgetMs: 0, chunkSize: 1, now: () => now, log: () => undefined }));
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

  describe("each segment's timing line", () => {
    /** A handler on a clock that moves 1 ms each time it is read, so every timed call takes 1 ms; and the lines it logs. */
    async function timed(jobId: string, env: never) {
      const registry = jobRegistry();
      const jobs = memoryJobs(registry);
      const lines: string[] = [];
      let tick = 1000;
      registry.on(MOVE_IN_JOB, moveInJobHandler(env, jobs, { budgetMs: 0, chunkSize: 3, now: () => now, clock: () => tick++, log: (line) => lines.push(line) }));
      return { jobs, lines, parsed: () => lines.map((line) => JSON.parse(line)) };
    }

    it("says where the time went, how long the segment waited in the queue and how big the kitchen is, as numbers only", async () => {
      const { env, jobId } = await setUp();
      const { jobs, lines, parsed } = await timed(jobId, env);
      await queueMoveIn(jobs, { id: jobId, phase: "inspect", cursor: null }, 400);
      await jobs.drain();

      const [inspect, recipes] = parsed();
      expect(parsed()).toHaveLength(2);
      expect(inspect).toMatchObject({ event: "move_in_segment", waitMs: 600, claimed: true, recipesFound: 3, stages: { recipeWrites: { calls: 0, ms: 0 } } });
      expect(recipes).toMatchObject({
        event: "move_in_segment",
        claimed: true,
        recipesFound: 3,
        stages: { recipeWrites: { calls: 3, ms: 3 }, photoWrites: { calls: 1, ms: 1 }, organizers: { calls: 0, ms: 0 } },
      });
      // The next segment was stamped when the last one queued it.
      expect(recipes.waitMs).toBeGreaterThan(0);
      expect(recipes.stages.job.calls).toBeGreaterThan(3);
      expect(recipes.stages.backup.calls).toBeGreaterThan(0);
      expect(recipes.wallMs).toBeGreaterThan(recipes.stages.job.ms);
      // Nothing that names the job, the cook or a recipe.
      for (const line of lines) expect(line).not.toMatch(new RegExp(`${jobId}|chef|Pancakes|cook@`, "i"));
    });

    it("marks a segment that found another run doing the work, and one that stopped on an error, and a message with no time", async () => {
      const { env, jobId, store } = await setUp();
      const { lines, parsed } = await timed(jobId, env);
      const handler = moveInJobHandler(env, memoryJobs(jobRegistry()), { clock: () => 5, log: (line) => lines.push(line) });

      segment.instead = async (id) => ({ job: await store.loadJob(id), claimed: false });
      await handler({ jobId }, {} as never);
      segment.instead = async () => {
        throw new Error("the database is down");
      };
      await expect(handler({ jobId, queuedAt: 2 }, {} as never)).rejects.toThrow("the database is down");
      // A kitchen that can't be counted logs no size rather than failing the segment's line.
      const counting = /"ImportEntityCount" WHERE "jobId" = \? AND "entity" = 'recipes'/;
      const binding = database.binding as unknown as { prepare(sql: string): unknown };
      const failing = { ...(env as object), DB: new Proxy(binding, {
        get: (target, key) => key === "prepare"
          ? (sql: string) => { if (counting.test(sql)) throw new Error("D1 is down"); return binding.prepare(sql); }
          : Reflect.get(target, key, target),
      }) };
      segment.instead = async (id) => ({ job: await store.loadJob(id), claimed: true });
      await moveInJobHandler(failing as never, memoryJobs(jobRegistry()), { log: (line) => lines.push(line) })({ jobId }, {} as never).catch(() => undefined);

      expect(parsed()[0]).toMatchObject({ claimed: false, recipesFound: null, waitMs: null });
      expect(parsed()[1]).toMatchObject({ claimed: null, recipesFound: null, waitMs: 3 });
      expect(parsed()[2]).toMatchObject({ claimed: true, recipesFound: null });
    });
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

  it("leaves a held move-in to the run holding it, and a nudge gets it going if that run died", async () => {
    const { jobId, jobs, store } = await setUp();
    const token = (await store.claim(jobId, now)) as string;
    await queueMoveIn(jobs, { id: jobId, phase: "inspect", cursor: null });

    expect((await jobs.drain()).map(({ key, outcome }) => [key, outcome.status])).toEqual([[`move-in:${jobId}:inspect:-`, "done"]]);
    expect(job(jobId)).toMatchObject({ status: "queued", claimToken: token });

    // The run that held it died: its claim lapses, the move-in goes quiet, and the segment's own key is spent.
    await store.release(jobId, token);
    expect(await queueMoveIn(jobs, { id: jobId, phase: "inspect", cursor: null })).toBe(false);
    const quiet = new Date(now.getTime() - MOVE_IN_QUIET_MS).toISOString();
    expect(await nudgeMoveIn(jobs, { id: jobId, status: "queued", updatedAt: quiet }, now)).toBe(true);
    expect((await jobs.drain()).at(-1)?.outcome.status).toBe("done");
    expect(job(jobId)).toMatchObject({ status: "done-with-issues" });
  });

  it("lets the move-in go when a segment stops with an error, so the retry runs it rather than finding it held", async () => {
    const { bucket, jobId, jobs } = await setUp();
    bucket.failures = 1;
    await queueMoveIn(jobs, { id: jobId, phase: "inspect", cursor: null });

    const ran = await jobs.drain();

    expect(ran[0]).toMatchObject({ key: `move-in:${jobId}:inspect:-`, outcome: { status: "retry" } });
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
  it("queues the watch's first look and the first segment", async () => {
    const { jobs, queued } = recordingJobs();
    await startMoveInJob(jobs, "movein_1");
    expect(queued).toEqual([
      { type: "move-in.watch", payload: { jobId: "movein_1", look: 1 }, options: { key: "move-in:movein_1:watch:1", delaySeconds: 300 } },
      { type: "move-in.run", payload: { jobId: "movein_1", queuedAt: expect.any(Number) }, options: { key: "move-in:movein_1:inspect:-" } },
    ]);
    expect(MOVE_IN_WATCH_SECONDS).toBe(300);
    expect(MOVE_IN_WATCH.type).toBe("move-in.watch");
  });

  it("tries the watch again when its first send fails", async () => {
    const { jobs: recording, queued } = recordingJobs();
    let failures = 1;
    const jobs: Jobs = {
      enqueue: async (kind, payload, options) => {
        if (kind.type === "move-in.watch" && failures-- > 0) throw new Error("the queue blinked");
        return recording.enqueue(kind, payload, options);
      },
    };
    await startMoveInJob(jobs, "movein_1");
    expect(queued.map(({ type }) => type).sort()).toEqual(["move-in.run", "move-in.watch"]);
  });

  it("sends each one even when the other can't go, and says one failed", async () => {
    for (const failing of ["move-in.run", "move-in.watch"]) {
      const { jobs: recording, queued } = recordingJobs();
      const jobs: Jobs = {
        enqueue: async (kind, payload, options) => {
          if (kind.type === failing) throw new Error("the queue is down");
          return recording.enqueue(kind, payload, options);
        },
      };
      await expect(startMoveInJob(jobs, "movein_1")).rejects.toThrow("the queue is down");
      expect(queued.map(({ type }) => type)).toEqual([failing === "move-in.run" ? "move-in.watch" : "move-in.run"]);
    }
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
      { type: "move-in.watch", payload: { jobId, look: 4 }, options: { key: `move-in:${jobId}:watch:4`, delaySeconds: 300 } },
      { type: "move-in.run", payload: { jobId, queuedAt: now.getTime() }, options: { key: `move-in:${jobId}:nudge:${quiet}:${Math.floor(now.getTime() / 60_000)}` } },
    ]);
  });

  it("has its next look out before a nudge that fails, so the watch goes on", async () => {
    const { env, jobId } = await setUp();
    database.sqlite.prepare(`UPDATE "ImportJob" SET "updatedAt" = ?`).run(quiet);
    const { jobs: recording, queued } = recordingJobs();
    const jobs: Jobs = {
      enqueue: async (kind, payload, options) => {
        if (kind.type === "move-in.run") throw new Error("the queue is down");
        return recording.enqueue(kind, payload, options);
      },
    };

    await expect(moveInWatchHandler(env, jobs, { now: () => now })({ jobId, look: 1 }, { key: "k", attempt: 1 })).rejects.toThrow("the queue is down");
    expect(queued.map(({ options }) => options.key)).toEqual([`move-in:${jobId}:watch:2`]);
  });

  it("keeps time by the real clock unless told otherwise", async () => {
    const { env, jobId } = await setUp();
    database.sqlite.prepare(`UPDATE "ImportJob" SET "status" = 'running', "updatedAt" = ?`).run(new Date().toISOString());
    const { jobs, queued } = recordingJobs();
    await moveInWatchHandler(env, jobs)({ jobId, look: 1 }, { key: "k", attempt: 1 });
    expect(queued.map(({ type }) => type)).toEqual(["move-in.watch"]);
  });

  it("only looks again at a move-in that is moving, and stops at one that finished, is gone or isn't named", async () => {
    const { env, jobId } = await setUp();
    const { jobs, queued } = recordingJobs();
    const watch = moveInWatchHandler(env, jobs, { now: () => now });
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

  it("queues a move-in nothing has moved for a while, once for each quiet stretch, and leaves a moving or finished one alone", async () => {
    const { jobs } = await setUp();
    const at = { id: "movein_1", status: "running" } as const;

    expect(await nudgeMoveIn(jobs, { ...at, updatedAt: quietFor(MOVE_IN_QUIET_MS - 1) }, now)).toBe(false);
    expect(await nudgeMoveIn(jobs, { ...at, status: "done", updatedAt: quietFor(MOVE_IN_QUIET_MS) }, now)).toBe(false);
    expect(await nudgeMoveIn(jobs, { ...at, updatedAt: quietFor(MOVE_IN_QUIET_MS) }, now)).toBe(true);
    // A nudge for this stretch is waiting now, so it is not queued twice that minute; a later stretch gets its own.
    expect(await nudgeMoveIn(jobs, { ...at, updatedAt: quietFor(MOVE_IN_QUIET_MS) }, now)).toBe(false);
    expect(await nudgeMoveIn(jobs, { ...at, updatedAt: quietFor(MOVE_IN_QUIET_MS + 1) }, now)).toBe(true);
    // A stretch that stays quiet gets a nudge the next minute, even if the last one found a run that then died.
    const later = new Date(now.getTime() + MOVE_IN_QUIET_MS);
    expect(await nudgeMoveIn(jobs, { ...at, updatedAt: quietFor(MOVE_IN_QUIET_MS) }, later)).toBe(true);
    expect(MOVE_IN_QUIET_MS).toBe(60_000);
  });
});
