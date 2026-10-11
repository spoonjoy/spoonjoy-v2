// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  D1_WRITE_UNAVAILABLE_CODE,
  D1_WRITE_UNAVAILABLE_MESSAGE,
  d1UnavailableWebResponse,
  D1WriteUnavailableError,
  formWriteToken,
  idForWriteToken,
  isD1Unavailable,
  retryD1Write,
  runWithD1WriteRetryReporter,
} from "~/lib/d1-write-retry.server";
import { expectConsoleWarning } from "../warning-policy";

const NETWORK_LOST = new Error("D1_ERROR: Network connection lost.");
const INTERNAL = new Error("D1_ERROR: internal error; reference = abc");
const UNIQUE = new Error("D1_ERROR: UNIQUE constraint failed: RecipeSpoon.id: SQLITE_CONSTRAINT");
// What Prisma's D1 adapter throws for the same failure.
const PRISMA_NETWORK_LOST = new Error(
  "\nInvalid `prisma.unit.create()` invocation:\n\n\nError occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(SqliteError { extended_code: 1, message: Some(\"D1_ERROR: Network connection lost.\") }), transient: false })",
);

/** A write that fails with the queued errors, in order, then answers its call count. */
function queuedWrite(failures: unknown[]) {
  const queue = [...failures];
  let calls = 0;
  const write = vi.fn(async () => {
    calls += 1;
    const failure = queue.shift();
    if (failure !== undefined) throw failure;
    return `written on try ${calls}`;
  });
  return write;
}

function options<T>(extra: Partial<Parameters<typeof retryD1Write<T>>[0]> = {}) {
  const sleeps: number[] = [];
  return {
    sleeps,
    options: {
      scope: "test.write",
      delaysMs: [1, 2, 3],
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
      ...extra,
    },
  };
}

describe("retryD1Write", () => {
  it("answers the first try's result without retrying", async () => {
    const write = queuedWrite([]);
    const { options: opts, sleeps } = options<string>();
    await expect(retryD1Write(opts, write)).resolves.toBe("written on try 1");
    expect(write).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it("runs an idempotent write again after each transient error, with the backoff", async () => {
    const write = queuedWrite([NETWORK_LOST, PRISMA_NETWORK_LOST, INTERNAL]);
    const { options: opts, sleeps } = options<string>();
    await expect(retryD1Write(opts, write)).resolves.toBe("written on try 4");
    expect(sleeps).toEqual([1, 2, 3]);
  });

  it("gives up with D1WriteUnavailableError, carrying the last error, once the tries run out", async () => {
    const write = queuedWrite([NETWORK_LOST, NETWORK_LOST, NETWORK_LOST, INTERNAL]);
    const { options: opts, sleeps } = options<string>();
    const error = await retryD1Write(opts, write).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(D1WriteUnavailableError);
    expect((error as D1WriteUnavailableError).scope).toBe("test.write");
    expect((error as Error).cause).toBe(INTERNAL);
    expect((error as Error).message).toBe("The database was briefly unavailable, so test.write was not saved");
    expect(write).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([1, 2, 3]);
  });

  it("passes any other error through on the first try, without asking whether it applied", async () => {
    const applied = vi.fn(async () => "never");
    const write = queuedWrite([UNIQUE]);
    const { options: opts } = options<string>({ applied });
    await expect(retryD1Write(opts, write)).rejects.toBe(UNIQUE);
    expect(applied).not.toHaveBeenCalled();
  });

  it("answers the earlier try's result when the ambiguous write had committed, without writing again", async () => {
    const applied = vi.fn(async () => "committed earlier");
    const write = queuedWrite([NETWORK_LOST]);
    const { options: opts, sleeps } = options<string>({ applied });
    await expect(retryD1Write(opts, write)).resolves.toBe("committed earlier");
    expect(write).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([1]);
  });

  it("writes again when the ambiguous write had not committed", async () => {
    const applied = vi.fn(async () => null);
    const write = queuedWrite([NETWORK_LOST]);
    const { options: opts } = options<string>({ applied });
    await expect(retryD1Write(opts, write)).resolves.toBe("written on try 2");
    expect(applied).toHaveBeenCalledTimes(1);
  });

  it("answers the earlier try when a retry fails on the row that try wrote late", async () => {
    const applied = vi.fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("committed late");
    const write = queuedWrite([NETWORK_LOST, UNIQUE]);
    const { options: opts } = options<string>({ applied });
    await expect(retryD1Write(opts, write)).resolves.toBe("committed late");
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("passes a retry's other error through when the earlier try had not committed", async () => {
    const applied = vi.fn(async () => null);
    const write = queuedWrite([NETWORK_LOST, UNIQUE]);
    const { options: opts } = options<string>({ applied });
    await expect(retryD1Write(opts, write)).rejects.toBe(UNIQUE);
  });

  it("passes a retry's other error through for an idempotent write", async () => {
    const write = queuedWrite([NETWORK_LOST, UNIQUE]);
    const { options: opts } = options<string>();
    await expect(retryD1Write(opts, write)).rejects.toBe(UNIQUE);
  });

  it("checks once more after the last try before giving up", async () => {
    const applied = vi.fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("committed on the last try");
    const write = queuedWrite([NETWORK_LOST, NETWORK_LOST]);
    const { options: opts } = options<string>({ applied, delaysMs: [1] });
    await expect(retryD1Write(opts, write)).resolves.toBe("committed on the last try");
  });

  it("gives up rather than writing again when it cannot tell whether the write committed", async () => {
    const applied = vi.fn(async () => {
      throw INTERNAL;
    });
    const write = queuedWrite([NETWORK_LOST]);
    const { options: opts } = options<string>({ applied });
    const error = await retryD1Write(opts, write).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(D1WriteUnavailableError);
    expect((error as Error).cause).toBe(NETWORK_LOST);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("passes the check's own non-transient error through", async () => {
    const broken = new Error("check failed");
    const applied = vi.fn(async () => {
      throw broken;
    });
    const write = queuedWrite([NETWORK_LOST]);
    const { options: opts } = options<string>({ applied });
    await expect(retryD1Write(opts, write)).rejects.toBe(broken);
  });

  it("uses the default backoff and a real timer without options", async () => {
    vi.useFakeTimers();
    try {
      const write = queuedWrite([NETWORK_LOST]);
      const pending = retryD1Write({ scope: "test.write" }, write);
      await vi.advanceTimersByTimeAsync(50);
      await expect(pending).resolves.toBe("written on try 2");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("runWithD1WriteRetryReporter", () => {
  it("logs each retry decision as one JSON line with no SQL or values on a per-run QA Worker", async () => {
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);
    const applied = vi.fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("in");
    await runWithD1WriteRetryReporter({ SPOONJOY_QA_ERROR_LOGS: "1" }, () =>
      retryD1Write(options<string>({ applied }).options, queuedWrite([NETWORK_LOST, INTERNAL])), log);
    await runWithD1WriteRetryReporter({ SPOONJOY_QA_ERROR_LOGS: "1" }, () =>
      retryD1Write(options<string>({ delaysMs: [] }).options, queuedWrite([NETWORK_LOST])).catch(() => null), log);

    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { event: "d1_write_retry", scope: "test.write", attempt: 1, kind: "network_connection_lost", outcome: "retry" },
      { event: "d1_write_retry", scope: "test.write", attempt: 2, kind: "internal_error", outcome: "applied" },
      { event: "d1_write_retry", scope: "test.write", attempt: 1, kind: "network_connection_lost", outcome: "gave_up" },
    ]);
  });

  it("writes the lines to console.warn by default", async () => {
    expectConsoleWarning(JSON.stringify({ event: "d1_write_retry", scope: "test.write", attempt: 1, kind: "network_connection_lost", outcome: "retry" }));
    await expect(runWithD1WriteRetryReporter({ SPOONJOY_QA_ERROR_LOGS: "1" }, () =>
      retryD1Write(options<string>().options, queuedWrite([NETWORK_LOST])))).resolves.toBe("written on try 2");
  });

  it("reports nothing anywhere else, and answers the run's own result", async () => {
    const log = vi.fn();
    await expect(runWithD1WriteRetryReporter({}, () =>
      retryD1Write(options<string>().options, queuedWrite([NETWORK_LOST])), log)).resolves.toBe("written on try 2");
    expect(runWithD1WriteRetryReporter({ SPOONJOY_QA_ERROR_LOGS: "0" }, () => 7, log)).toBe(7);
    await expect(retryD1Write(options<string>().options, queuedWrite([NETWORK_LOST]))).resolves.toBe("written on try 2");
    expect(log).not.toHaveBeenCalled();
  });

  it("never lets a throwing log change the write's outcome", async () => {
    await expect(runWithD1WriteRetryReporter({ SPOONJOY_QA_ERROR_LOGS: "1" }, () =>
      retryD1Write(options<string>().options, queuedWrite([NETWORK_LOST])), () => {
      throw new Error("log sink down");
    })).resolves.toBe("written on try 2");
  });
});

describe("isD1Unavailable", () => {
  it("is true for a write out of tries and for any transient D1 error, raw or from Prisma", () => {
    expect(isD1Unavailable(new D1WriteUnavailableError("x", NETWORK_LOST))).toBe(true);
    expect(isD1Unavailable(NETWORK_LOST)).toBe(true);
    expect(isD1Unavailable(PRISMA_NETWORK_LOST)).toBe(true);
    expect(isD1Unavailable(UNIQUE)).toBe(false);
    expect(isD1Unavailable(null)).toBe(false);
  });
});

describe("d1UnavailableWebResponse", () => {
  it("answers a retryable 503 with the friendly message and the form's intent", () => {
    const response = d1UnavailableWebResponse(new D1WriteUnavailableError("x", NETWORK_LOST), "createSpoon");
    expect(response).not.toBeNull();
    expect(response!.init?.status).toBe(503);
    const headers = new Headers(response!.init?.headers);
    expect(headers.get("Retry-After")).toBe("1");
    expect(headers.get("Cache-Control")).toBe("private, no-store");
    expect(response!.data).toEqual({
      intent: "createSpoon",
      error: D1_WRITE_UNAVAILABLE_MESSAGE,
      errorCode: D1_WRITE_UNAVAILABLE_CODE,
      retryable: true,
    });
    expect(d1UnavailableWebResponse(INTERNAL)!.data).toEqual({
      error: D1_WRITE_UNAVAILABLE_MESSAGE,
      errorCode: D1_WRITE_UNAVAILABLE_CODE,
      retryable: true,
    });
  });

  it("is null for any other error", () => {
    expect(d1UnavailableWebResponse(UNIQUE)).toBeNull();
  });
});

describe("formWriteToken", () => {
  it("accepts a form's token and refuses a missing, malformed or file value", () => {
    expect(formWriteToken("6f1c2d3e-aaaa-4bbb-8ccc-0123456789ab")).toBe("6f1c2d3e-aaaa-4bbb-8ccc-0123456789ab");
    expect(formWriteToken("short")).toBeNull();
    expect(formWriteToken("x".repeat(101))).toBeNull();
    expect(formWriteToken("has spaces in it")).toBeNull();
    expect(formWriteToken(null)).toBeNull();
    expect(formWriteToken(undefined)).toBeNull();
    expect(formWriteToken(new File(["x"], "token.txt"))).toBeNull();
  });
});

describe("idForWriteToken", () => {
  it("derives the same UUID-shaped id for the same submission, and a different one for anything else", async () => {
    const id = await idForWriteToken("spoon:recipe-1", "chef-1", "token-abcdef");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    await expect(idForWriteToken("spoon:recipe-1", "chef-1", "token-abcdef")).resolves.toBe(id);
    const others = await Promise.all([
      idForWriteToken("spoon:recipe-2", "chef-1", "token-abcdef"),
      idForWriteToken("spoon:recipe-1", "chef-2", "token-abcdef"),
      idForWriteToken("spoon:recipe-1", "chef-1", "token-abcdeg"),
    ]);
    expect(new Set([id, ...others]).size).toBe(4);
  });
});
