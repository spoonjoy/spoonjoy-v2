// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as platform from "~/domains/platform";
import { defineJob, jobRegistry, PlatformUnavailableError, retryDelaySeconds, runJob, type JobKeys, type JobMessage } from "~/domains/platform";
import * as platformServer from "~/domains/platform/index.server";
import { consumeJobBatch, d1JobKeys, expireDoneJobKeys, JOB_KEY_KEPT_DAYS, jobKeysDatabase, memoryJobs, queueJobs } from "~/domains/platform/index.server";
import { migratedSqliteD1, type MigratedSqlite } from "../../helpers/migrated-sqlite";

const moveIn = defineJob<{ jobId: string }>("move-in.run", { maxAttempts: 3 });
const welcome = defineJob<{ userId: string }>("welcome.send");

function keysInMemory(): JobKeys & { rows: Map<string, string>; runs: Map<string, number> } {
  const rows = new Map<string, string>();
  const runs = new Map<string, number>();
  return {
    rows,
    runs,
    async claim(key) {
      if (rows.has(key)) return false;
      rows.set(key, "pending");
      return true;
    },
    async start(key) {
      const status = rows.get(key);
      if (status === "done") return { state: "done" };
      if (status === "running") return { state: "busy", retryInSeconds: 75 };
      rows.set(key, "running");
      const run = (runs.get(key) ?? 0) + 1;
      runs.set(key, run);
      return { state: "started", run };
    },
    async pause(key) {
      rows.set(key, "pending");
    },
    async markDone(key) {
      rows.set(key, "done");
    },
    async release(key) {
      rows.delete(key);
    },
  };
}

describe("job kinds and the handler registry", () => {
  it("names a job and how many times it may run, five by default", () => {
    expect(moveIn).toMatchObject({ type: "move-in.run", maxAttempts: 3 });
    expect(welcome.maxAttempts).toBe(5);
  });

  it("finds each kind's handler by its type, and refuses a second handler for one kind", () => {
    const handler = vi.fn(async () => {});
    const registry = jobRegistry().on(moveIn, handler);
    expect(registry.handlerFor("move-in.run")?.kind).toBe(moveIn);
    expect(registry.handlerFor("welcome.send")).toBeUndefined();
    expect(() => registry.on(moveIn, handler)).toThrow('A handler for "move-in.run" is already registered');
  });
});

describe("retry with backoff", () => {
  it("waits 10 s after the first failure, doubling each time, never more than 15 minutes", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(retryDelaySeconds)).toEqual([10, 20, 40, 80, 160, 320, 640, 900]);
  });
});

describe("running one job", () => {
  const message = (key = "move-in:job-1"): JobMessage => ({ type: "move-in.run", key, payload: { jobId: "job-1" } });

  it("runs its handler with the payload, then marks its key done", async () => {
    const keys = keysInMemory();
    await keys.claim("move-in:job-1", "move-in.run");
    const handler = vi.fn(async () => {});
    const outcome = await runJob(jobRegistry().on(moveIn, handler), keys, message());
    expect(outcome).toEqual({ status: "done" });
    expect(handler).toHaveBeenCalledWith({ jobId: "job-1" }, { key: "move-in:job-1", attempt: 1 });
    expect(keys.rows.get("move-in:job-1")).toBe("done");
  });

  it("skips a job whose key is already done, so a delivery that comes twice runs once", async () => {
    const keys = keysInMemory();
    keys.rows.set("move-in:job-1", "done");
    const handler = vi.fn(async () => {});
    expect(await runJob(jobRegistry().on(moveIn, handler), keys, message())).toEqual({ status: "skipped", reason: "already-done" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("leaves a job no handler here knows for a later delivery, without touching its key", async () => {
    // During a deploy or rollback, a Worker that doesn't know the kind may get its message.
    const keys = keysInMemory();
    keys.rows.set("move-in:job-1", "running");
    expect(await runJob(jobRegistry(), keys, message())).toEqual({ status: "unhandled", delaySeconds: 300 });
    expect(keys.rows.get("move-in:job-1")).toBe("running");
  });

  it("waits while another delivery of the same key is running, so a key's handler runs once at a time", async () => {
    const keys = keysInMemory();
    keys.rows.set("move-in:job-1", "running");
    const handler = vi.fn(async () => {});
    // It comes back once the other run's lease is up, not before, so waiting never uses up attempts.
    expect(await runJob(jobRegistry().on(moveIn, handler), keys, message())).toEqual({ status: "busy", delaySeconds: 75 });
    expect(handler).not.toHaveBeenCalled();
  });

  it("retries a failed run after its backoff until its runs reach maxAttempts, then frees its key", async () => {
    const keys = keysInMemory();
    await keys.claim("move-in:job-1", "move-in.run");
    const error = new Error("D1 was busy");
    const registry = jobRegistry().on(moveIn, async () => {
      throw error;
    });
    expect(await runJob(registry, keys, message())).toEqual({ status: "retry", delaySeconds: 10 });
    expect(await runJob(registry, keys, message())).toEqual({ status: "retry", delaySeconds: 20 });
    // Between runs the key is free for the next delivery to start.
    expect(keys.rows.get("move-in:job-1")).toBe("pending");
    expect(await runJob(registry, keys, message())).toEqual({ status: "failed", error });
    // A failed job can be enqueued again under the same key.
    expect(keys.rows.has("move-in:job-1")).toBe(false);
  });
});

describe("the Cloudflare Queues adapter", () => {
  it("sends a typed job once per key", async () => {
    const send = vi.fn(async () => {});
    const keys = keysInMemory();
    const jobs = queueJobs({ send } as never, keys);
    expect(await jobs.enqueue(moveIn, { jobId: "job-1" }, { key: "move-in:job-1" })).toEqual({ enqueued: true });
    expect(await jobs.enqueue(moveIn, { jobId: "job-1" }, { key: "move-in:job-1" })).toEqual({ enqueued: false });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: "move-in.run", key: "move-in:job-1", payload: { jobId: "job-1" } }, {});
    await jobs.enqueue(welcome, { userId: "u1" }, { key: "welcome:u1", delaySeconds: 60 });
    expect(send).toHaveBeenLastCalledWith({ type: "welcome.send", key: "welcome:u1", payload: { userId: "u1" } }, { delaySeconds: 60 });
  });

  it("frees the key when the queue refuses the job, so enqueueing it again works", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("queue down")).mockResolvedValue(undefined);
    const jobs = queueJobs({ send } as never, keysInMemory());
    await expect(jobs.enqueue(moveIn, { jobId: "job-1" }, { key: "move-in:job-1" })).rejects.toThrow("queue down");
    expect(await jobs.enqueue(moveIn, { jobId: "job-1" }, { key: "move-in:job-1" })).toEqual({ enqueued: true });
  });

  it("says the jobs port is unavailable without the JOBS queue binding", async () => {
    const jobs = queueJobs(undefined, keysInMemory());
    const refusal = jobs.enqueue(moveIn, { jobId: "job-1" }, { key: "move-in:job-1" });
    await expect(refusal).rejects.toBeInstanceOf(PlatformUnavailableError);
    await expect(refusal).rejects.toMatchObject({ port: "jobs" });
    await expect(jobs.enqueue(moveIn, { jobId: "job-1" }, { key: "k" })).rejects.toThrow("The jobs port is not available here: the JOBS queue binding is not configured.");
  });

  it("acks finished and skipped messages, and retries a failed one after its backoff", async () => {
    const keys = keysInMemory();
    for (const key of ["a", "b", "c"]) await keys.claim(key, "move-in.run");
    keys.rows.set("b", "done");
    const registry = jobRegistry().on(moveIn, async ({ jobId }) => {
      if (jobId === "fails") throw new Error("not yet");
    });
    const delivery = (key: string, jobId: string, attempts: number) => ({
      body: { type: "move-in.run", key, payload: { jobId } },
      attempts,
      ack: vi.fn(),
      retry: vi.fn(),
    });
    const malformed = { body: { nope: true }, attempts: 1, ack: vi.fn(), retry: vi.fn() };
    const empty = { body: null, attempts: 1, ack: vi.fn(), retry: vi.fn() };
    keys.runs.set("d", 2);
    const messages = [delivery("a", "ok", 1), delivery("b", "ok", 1), delivery("c", "fails", 4), delivery("d", "fails", 1), malformed, empty];
    const failed = vi.fn(() => {
      throw new Error("PostHog is down");
    });
    await consumeJobBatch({ messages } as never, registry, keys, { onFailed: failed });
    expect(messages.map((m) => [m.ack.mock.calls.length, m.retry.mock.calls]))
      .toEqual([[1, []], [1, []], [0, [[{ delaySeconds: 10 }]]], [1, []], [1, []], [1, []]]);
    expect(failed).toHaveBeenCalledWith(messages[3].body, expect.objectContaining({ message: "not yet" }));
  });

  it("retries a message whose bookkeeping throws, instead of failing the whole batch", async () => {
    const keys = { ...keysInMemory(), markDone: vi.fn(async () => {
      throw new Error("D1 dropped the write");
    }) };
    await keys.claim("a", "move-in.run");
    const registry = jobRegistry().on(moveIn, async () => {});
    const message = { body: { type: "move-in.run", key: "a", payload: { jobId: "ok" } }, attempts: 1, ack: vi.fn(), retry: vi.fn() };
    await consumeJobBatch({ messages: [message] } as never, registry, keys);
    expect([message.ack.mock.calls.length, message.retry.mock.calls]).toEqual([0, [[{ delaySeconds: 10 }]]]);
  });
});

describe("the D1 job keys", () => {
  let database: MigratedSqlite;
  beforeEach(() => {
    database = migratedSqliteD1();
  });
  afterEach(() => database.close());

  let clock = new Date("2026-11-23T12:00:00.000Z");
  const later = (seconds: number) => (clock = new Date(clock.getTime() + seconds * 1000));
  const status = (key: string) => database.sqlite.prepare(`SELECT "type", "status" FROM "PlatformJobKey" WHERE "key" = ?`).get(key);

  it("claims a key once, leases it to one run at a time, marks it done, and frees it", async () => {
    clock = new Date("2026-11-23T12:00:00.000Z");
    const keys = d1JobKeys(database.binding, () => clock);
    expect(await keys.claim("k", "move-in.run")).toBe(true);
    expect(await keys.claim("k", "move-in.run")).toBe(false);
    expect(await keys.start("k", "move-in.run", 600)).toEqual({ state: "started", run: 1 });
    later(100);
    // Another delivery waits out the lease, and a few seconds more.
    expect(await keys.start("k", "move-in.run", 600)).toEqual({ state: "busy", retryInSeconds: 505 });
    // A run that died without a word loses its lease once the lease runs out.
    later(501);
    expect(await keys.start("k", "move-in.run", 600)).toEqual({ state: "started", run: 2 });
    await keys.pause("k");
    expect(status("k")).toEqual({ type: "move-in.run", status: "pending" });
    expect(await keys.start("k", "move-in.run", 600)).toEqual({ state: "started", run: 3 });
    await keys.markDone("k");
    expect(await keys.start("k", "move-in.run", 600)).toEqual({ state: "done" });
    expect(await keys.claim("k", "move-in.run")).toBe(false);
    await keys.release("k");
    expect(await keys.claim("k", "move-in.run")).toBe(true);
  });

  it("starts a delivery whose key has no row, and lets a key left pending for a day be claimed again", async () => {
    clock = new Date("2026-11-23T12:00:00.000Z");
    const keys = d1JobKeys(database.binding, () => clock);
    expect(await keys.start("orphan", "move-in.run", 600)).toEqual({ state: "started", run: 1 });
    expect(await keys.claim("lost", "move-in.run")).toBe(true);
    later(23 * 3600);
    expect(await keys.claim("lost", "move-in.run")).toBe(false);
    later(3600 + 1);
    expect(await keys.claim("lost", "move-in.run")).toBe(true);
  });

  it("answers busy when a key changes between its two reads, or a driver leaves out what it changed", async () => {
    clock = new Date("2026-11-23T12:00:00.000Z");
    // A database whose answers to one statement are replaced, as another run or another D1 driver would leave them.
    const answering = (match: string, answer: { results?: unknown[]; meta?: object }) => ({
      prepare: (query: string) => {
        const statement = database.binding.prepare(query);
        if (!query.includes(match)) return statement;
        return { bind: () => ({ run: async () => answer, all: async () => answer }) };
      },
    });
    const gone = d1JobKeys(answering(`SELECT "status", "leaseUntil"`, { results: [] }) as never, () => clock);
    const real = d1JobKeys(database.binding, () => clock);
    await real.claim("k", "move-in.run");
    await real.markDone("k");
    expect(await gone.start("k", "move-in.run", 600)).toEqual({ state: "busy", retryInSeconds: 5 });
    const unleased = d1JobKeys(answering(`SELECT "status", "leaseUntil"`, { results: [{ status: "running", leaseUntil: null }] }) as never, () => clock);
    expect(await unleased.start("k", "move-in.run", 600)).toEqual({ state: "busy", retryInSeconds: 5 });
    const quiet = d1JobKeys(answering(`INSERT INTO "PlatformJobKey" ("key", "type", "status", "createdAt"`, { meta: {} }) as never, () => clock);
    expect(await quiet.claim("other", "move-in.run")).toBe(false);
  });

  it("keeps time by the real clock unless told otherwise", async () => {
    const keys = d1JobKeys(database.binding);
    expect(await keys.claim("k", "move-in.run")).toBe(true);
    expect(await keys.start("k", "move-in.run", 600)).toEqual({ state: "started", run: 1 });
  });

  it("lets a key whose run died, its lease run out and its message gone, be claimed again", async () => {
    clock = new Date("2026-11-23T12:00:00.000Z");
    const keys = d1JobKeys(database.binding, () => clock);
    await keys.claim("k", "move-in.run");
    await keys.start("k", "move-in.run", 600);
    expect(await keys.claim("k", "move-in.run")).toBe(false);
    later(601);
    expect(await keys.claim("k", "move-in.run")).toBe(true);
    expect(status("k")).toEqual({ type: "move-in.run", status: "pending" });
  });

  it("forgets a done key once it has been done for 30 days, and keeps every other key", async () => {
    clock = new Date("2026-11-23T12:00:00.000Z");
    const keys = d1JobKeys(database.binding, () => clock);
    for (const key of ["old", "recent", "waiting", "running"]) await keys.claim(key, "move-in.run");
    await keys.start("old", "move-in.run", 60);
    await keys.markDone("old");
    await keys.start("running", "move-in.run", 60 * 60 * 24 * 60);
    later(JOB_KEY_KEPT_DAYS * 24 * 60 * 60 - 1);
    await keys.start("recent", "move-in.run", 60);
    await keys.markDone("recent");
    later(2);
    expect(await expireDoneJobKeys(database.binding, () => clock)).toBe(1);
    expect(status("old")).toBeUndefined();
    expect(status("recent")).toEqual({ type: "move-in.run", status: "done" });
    expect(status("waiting")).toEqual({ type: "move-in.run", status: "pending" });
    expect(status("running")).toEqual({ type: "move-in.run", status: "running" });
    // Forgotten, the same job can be enqueued again.
    expect(await keys.claim("old", "move-in.run")).toBe(true);
  });

  it("takes the job keys' database only from a binding that is one", () => {
    expect(jobKeysDatabase(database.binding)).toBe(database.binding);
    for (const candidate of [undefined, null, {}, { prepare: "no" }]) expect(jobKeysDatabase(candidate)).toBeNull();
  });

  it("expires by the real clock unless told otherwise, and counts none when D1 says nothing changed", async () => {
    expect(await expireDoneJobKeys(database.binding)).toBe(0);
    const silent = { prepare: () => ({ bind: () => ({ run: async () => ({ meta: {} }), all: async () => ({ results: [] }) }) }) };
    expect(await expireDoneJobKeys(silent)).toBe(0);
  });
});

describe("the test adapter", () => {
  it("runs enqueued jobs when drained, once per key, retrying failures without waiting", async () => {
    let failures = 1;
    const seen: Array<[string, number]> = [];
    const registry = jobRegistry().on(moveIn, async ({ jobId }, { attempt }) => {
      seen.push([jobId, attempt]);
      if (failures-- > 0) throw new Error("first try fails");
    });
    const jobs = memoryJobs(registry);
    expect(await jobs.enqueue(moveIn, { jobId: "job-1" }, { key: "move-in:job-1" })).toEqual({ enqueued: true });
    expect(await jobs.enqueue(moveIn, { jobId: "job-1" }, { key: "move-in:job-1" })).toEqual({ enqueued: false });
    expect(await jobs.drain()).toEqual([
      { type: "move-in.run", key: "move-in:job-1", outcome: { status: "retry", delaySeconds: 10 } },
      { type: "move-in.run", key: "move-in:job-1", outcome: { status: "done" } },
    ]);
    expect(seen).toEqual([["job-1", 1], ["job-1", 2]]);
    expect(await jobs.enqueue(moveIn, { jobId: "job-1" }, { key: "move-in:job-1" })).toEqual({ enqueued: false });
  });

  it("frees the key of a job that fails every run, so it can be enqueued again", async () => {
    const jobs = memoryJobs(jobRegistry().on(moveIn, async () => {
      throw new Error("never works");
    }));
    await jobs.enqueue(moveIn, { jobId: "job-1" }, { key: "move-in:job-1" });
    expect((await jobs.drain()).map((ran) => ran.outcome.status)).toEqual(["retry", "retry", "failed"]);
    expect(await jobs.enqueue(moveIn, { jobId: "job-1" }, { key: "move-in:job-1" })).toEqual({ enqueued: true });
  });

  it("reports a job no handler knows once, and drops it", async () => {
    const jobs = memoryJobs(jobRegistry());
    await jobs.enqueue(welcome, { userId: "u" }, { key: "welcome:u" });
    expect((await jobs.drain()).map((ran) => ran.outcome.status)).toEqual(["unhandled"]);
  });

});

describe("Platform's two barrels", () => {
  it("keeps every adapter out of the port's barrel, behind the server one", () => {
    for (const adapter of ["queueJobs", "consumeJobBatch", "d1JobKeys", "expireDoneJobKeys", "memoryJobs"]) {
      expect(Object.keys(platform)).not.toContain(adapter);
      expect(Object.keys(platformServer)).toContain(adapter);
    }
    expect(Object.keys(platform)).toEqual(expect.arrayContaining(["defineJob", "jobRegistry", "runJob"]));
  });
});
