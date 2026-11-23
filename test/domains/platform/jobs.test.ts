// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeJobBatch,
  d1JobKeys,
  defineJob,
  jobRegistry,
  JobsUnavailableError,
  memoryJobs,
  queueJobs,
  retryDelaySeconds,
  runJob,
  type JobKeys,
  type JobMessage,
} from "~/domains/platform";
import { migratedSqliteD1, type MigratedSqlite } from "../../helpers/migrated-sqlite";

const moveIn = defineJob<{ jobId: string }>("move-in.run", { maxAttempts: 3 });
const welcome = defineJob<{ userId: string }>("welcome.send");

function keysInMemory(): JobKeys & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return {
    rows,
    async claim(key) {
      if (rows.has(key)) return false;
      rows.set(key, "pending");
      return true;
    },
    async isDone(key) {
      return rows.get(key) === "done";
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
    const outcome = await runJob(jobRegistry().on(moveIn, handler), keys, message(), 1);
    expect(outcome).toEqual({ status: "done" });
    expect(handler).toHaveBeenCalledWith({ jobId: "job-1" }, { key: "move-in:job-1", attempt: 1 });
    expect(keys.rows.get("move-in:job-1")).toBe("done");
  });

  it("skips a job whose key is already done, so a delivery that comes twice runs once", async () => {
    const keys = keysInMemory();
    keys.rows.set("move-in:job-1", "done");
    const handler = vi.fn(async () => {});
    expect(await runJob(jobRegistry().on(moveIn, handler), keys, message(), 1)).toEqual({ status: "skipped", reason: "already-done" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("skips a job no handler is registered for", async () => {
    expect(await runJob(jobRegistry(), keysInMemory(), message(), 1)).toEqual({ status: "skipped", reason: "unknown-type" });
  });

  it("retries a failed run after its backoff until its attempts run out, then frees its key", async () => {
    const keys = keysInMemory();
    await keys.claim("move-in:job-1", "move-in.run");
    const error = new Error("D1 was busy");
    const registry = jobRegistry().on(moveIn, async () => {
      throw error;
    });
    expect(await runJob(registry, keys, message(), 1)).toEqual({ status: "retry", delaySeconds: 10 });
    expect(await runJob(registry, keys, message(), 2)).toEqual({ status: "retry", delaySeconds: 20 });
    expect(keys.rows.get("move-in:job-1")).toBe("pending");
    expect(await runJob(registry, keys, message(), 3)).toEqual({ status: "failed", error });
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
    await expect(refusal).rejects.toBeInstanceOf(JobsUnavailableError);
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
    const messages = [delivery("a", "ok", 1), delivery("b", "ok", 1), delivery("c", "fails", 2), delivery("d", "fails", 3)];
    const failed = vi.fn();
    await consumeJobBatch({ messages } as never, registry, keys, { onFailed: failed });
    expect(messages.map((m) => [m.ack.mock.calls.length, m.retry.mock.calls]))
      .toEqual([[1, []], [1, []], [0, [[{ delaySeconds: 20 }]]], [1, []]]);
    expect(failed).toHaveBeenCalledWith(messages[3].body, expect.objectContaining({ message: "not yet" }));
  });
});

describe("the D1 job keys", () => {
  let database: MigratedSqlite;
  beforeEach(() => {
    database = migratedSqliteD1();
  });
  afterEach(() => database.close());

  it("claims a key once, marks it done, and frees it", async () => {
    const keys = d1JobKeys(database.binding, () => new Date("2026-11-23T12:00:00.000Z"));
    expect(await keys.claim("move-in:job-1", "move-in.run")).toBe(true);
    expect(await keys.claim("move-in:job-1", "move-in.run")).toBe(false);
    expect(await keys.isDone("move-in:job-1")).toBe(false);
    await keys.markDone("move-in:job-1");
    expect(await keys.isDone("move-in:job-1")).toBe(true);
    expect(database.sqlite.prepare(`SELECT "type", "status" FROM "PlatformJobKey" WHERE "key" = ?`).get("move-in:job-1")).toEqual({ type: "move-in.run", status: "done" });
    await keys.release("move-in:job-1");
    expect(await keys.claim("move-in:job-1", "move-in.run")).toBe(true);
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
});
