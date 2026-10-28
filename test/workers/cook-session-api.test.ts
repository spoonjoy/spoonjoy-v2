// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCookSessionProtocolRequest } from "../../workers/cook-session-api";
import { expectConsoleWarning } from "../warning-policy";

const RESET_MESSAGE = "Internal error in Durable Object storage caused object to be reset";

function storageReset() {
  return Object.assign(new Error(RESET_MESSAGE), { retryable: true });
}

const replayed = (call: string, marked = true) => JSON.stringify({ event: "platform_retry", call, attempt: 2, marked });

// The Workers runtime's message for the failure inside Cloudflare in Journeys run 40566824130.
function cloudflareInternalError() {
  return new Error("internal error; reference = 9fk2mq3c8b1d7e6a5h4j");
}

function request(operation: "detail" | "start" | "patch" = "detail") {
  const body = operation === "patch" ? JSON.stringify({
    attemptId: "11111111-1111-4111-8111-111111111111",
    expectedRevision: 0,
    mutationId: "mutation-1",
    changes: { activeStepIndex: 0 },
  }) : undefined;
  return new Request(
    `https://spoonjoy.app/api/cook-sessions/recipe-1${operation === "start" ? "/start" : ""}`,
    {
      method: operation === "detail" ? "GET" : operation === "start" ? "POST" : "PATCH",
      headers: { "X-Spoonjoy-Cook-User": "user-1" },
      body,
    },
  );
}

function environment(first: unknown, next: unknown = Response.json({ state: null })) {
  const requests: Request[] = [];
  let handles = 0;
  const get = vi.fn(() => {
    const result = handles++ === 0 ? first : next;
    return {
      fetch: async (input: Request) => {
        requests.push(input);
        if (result instanceof Response) return result;
        throw result;
      },
    };
  });
  const statement = {
    bind: () => statement,
    first: async () => ({ id: "recipe-1" }),
    all: async () => ({ results: [] }),
  };
  const env = {
    COOK_SESSIONS: { idFromName: () => "object-1", get },
    DB: { prepare: () => statement },
  } as unknown as CloudflareEnvironment;
  return { env, get, requests };
}

describe("cook-session reads after a storage reset", () => {
  it("returns the session from a fresh stub after a retryable read failure", async () => {
    const state = {
      version: 1,
      recipeId: "recipe-1",
      attemptId: "11111111-1111-4111-8111-111111111111",
      status: "active",
      revision: 7,
      progress: {
        activeStepIndex: 0,
        activeStepId: null,
        scaleFactor: 2,
        checkedIngredientIds: [],
        checkedStepOutputIds: [],
      },
      startedAt: "2026-10-23T18:00:00.000Z",
      updatedAt: "2026-10-23T18:01:00.000Z",
      terminalAt: null,
    };
    const { env, get, requests } = environment(storageReset(), Response.json({ state }));
    expectConsoleWarning(replayed("cook_session.read"));

    const response = await handleCookSessionProtocolRequest(request(), env, "user-1", "detail", { requireExpectedUser: true });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state });
    expect(get).toHaveBeenCalledTimes(2);
    expect(requests.map((sent) => ({
      url: sent.url,
      method: sent.method,
      protocol: sent.headers.get("X-Spoonjoy-Cook-Protocol"),
    }))).toEqual([
      { url: "https://cook-session.internal/api/cook-sessions/recipe-1", method: "GET", protocol: "1" },
      { url: "https://cook-session.internal/api/cook-sessions/recipe-1", method: "GET", protocol: "1" },
    ]);
    expect(requests[0]).not.toBe(requests[1]);
  });

  it("propagates a second failure instead of retrying without a bound", async () => {
    const second = storageReset();
    const { env, get } = environment(storageReset(), second);
    expectConsoleWarning(replayed("cook_session.read"));

    await expect(handleCookSessionProtocolRequest(request(), env, "user-1", "detail", { requireExpectedUser: true }))
      .rejects.toBe(second);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["unmarked errors", new Error(RESET_MESSAGE)],
    ["explicitly permanent errors", Object.assign(new Error("permanent"), { retryable: false })],
    ["non-boolean retry markers", Object.assign(new Error("permanent"), { retryable: "true" })],
    ["overloaded objects", Object.assign(storageReset(), { overloaded: true })],
    ["non-errors", { retryable: true }],
    ["null", null],
    ["strings", RESET_MESSAGE],
  ])("does not replay reads for %s", async (_name, error) => {
    const { env, get } = environment(error);

    await expect(handleCookSessionProtocolRequest(request(), env, "user-1", "detail", { requireExpectedUser: true }))
      .rejects.toBe(error);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("never replays a progress write after a retryable failure", async () => {
    const error = storageReset();
    const { env, get } = environment(error);

    await expect(handleCookSessionProtocolRequest(request("patch"), env, "user-1", "patch", { requireExpectedUser: true }))
      .rejects.toBe(error);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("replays a start once, with a fresh stub, after a retryable failure, because a start resumes the session it finds", async () => {
    const state = {
      version: 1,
      recipeId: "recipe-1",
      attemptId: "11111111-1111-4111-8111-111111111111",
      status: "active",
      revision: 0,
      progress: {
        activeStepIndex: 0,
        activeStepId: null,
        scaleFactor: 1,
        checkedIngredientIds: [],
        checkedStepOutputIds: [],
      },
      startedAt: "2026-10-27T19:30:00.000Z",
      updatedAt: "2026-10-27T19:30:00.000Z",
      terminalAt: null,
    };
    const { env, get, requests } = environment(storageReset(), Response.json({ state }, { status: 200 }));
    expectConsoleWarning(replayed("cook_session.start"));

    const response = await handleCookSessionProtocolRequest(request("start"), env, "user-1", "start", { requireExpectedUser: true });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state });
    expect(get).toHaveBeenCalledTimes(2);
    expect(requests.map((sent) => `${sent.method} ${sent.url}`)).toEqual([
      "POST https://cook-session.internal/api/cook-sessions/recipe-1/start",
      "POST https://cook-session.internal/api/cook-sessions/recipe-1/start",
    ]);
  });

  it("replays a start once after Cloudflare's own internal error, marked retryable or not", async () => {
    const { env, get } = environment(cloudflareInternalError(), Response.json({ state: null }, { status: 201 }));
    expectConsoleWarning(replayed("cook_session.start", false));

    const response = await handleCookSessionProtocolRequest(request("start"), env, "user-1", "start", { requireExpectedUser: true });

    expect(response.status).toBe(201);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("replays a read once after Cloudflare's own internal error", async () => {
    const { env, get } = environment(cloudflareInternalError(), Response.json({ state: null }, { status: 200 }));
    expectConsoleWarning(replayed("cook_session.read", false));

    const response = await handleCookSessionProtocolRequest(request(), env, "user-1", "detail", { requireExpectedUser: true });

    expect(response.status).toBe(200);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("never replays a progress write after Cloudflare's own internal error", async () => {
    const error = cloudflareInternalError();
    const { env, get } = environment(error);

    await expect(handleCookSessionProtocolRequest(request("patch"), env, "user-1", "patch", { requireExpectedUser: true }))
      .rejects.toBe(error);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["unmarked errors", new Error(RESET_MESSAGE)],
    ["overloaded objects", Object.assign(storageReset(), { overloaded: true })],
    ["an overloaded internal error", Object.assign(cloudflareInternalError(), { overloaded: true })],
    ["a message that only mentions an internal error", new Error("recipe failed: internal error; reference = abc")],
  ])("does not replay a start for %s", async (_name, error) => {
    const { env, get } = environment(error);

    await expect(handleCookSessionProtocolRequest(request("start"), env, "user-1", "start", { requireExpectedUser: true }))
      .rejects.toBe(error);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it.each([200, 404, 500])("keeps an ordinary HTTP %s response without replaying it", async (status) => {
    const { env, get } = environment(Response.json({ state: null }, { status }));
    const response = await handleCookSessionProtocolRequest(request(), env, "user-1", "detail", { requireExpectedUser: true });

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ state: null });
    response.headers.set("X-Worker-Finalized", "1");
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe("the Cooking now list after a cook-session write", () => {
  const state = {
    version: 1,
    recipeId: "recipe-1",
    attemptId: "11111111-1111-4111-8111-111111111111",
    status: "active",
    revision: 1,
    progress: {
      activeStepIndex: 0,
      activeStepId: "step-1",
      scaleFactor: 1,
      checkedIngredientIds: ["a", "b"],
      checkedStepOutputIds: ["c"],
    },
    startedAt: "2026-10-23T18:00:00.000Z",
    updatedAt: "2026-10-23T18:01:00.000Z",
    terminalAt: null,
  };

  // A D1 binding whose batch the test controls; reads answer as the recipe check expects.
  function recordingEnvironment(answer: Response, batch: (statements: Array<{ sql: string; values: unknown[] }>) => Promise<unknown[]>) {
    const statement = (sql: string, values: unknown[] = []) => ({
      sql,
      values,
      bind: (...bound: unknown[]) => statement(sql, bound),
      first: async () => ({ id: "recipe-1" }),
      all: async () => ({ results: sql.includes("RecipeStep") ? [{ id: "step-1" }] : [] }),
    });
    return {
      COOK_SESSIONS: { idFromName: () => "object-1", get: () => ({ fetch: async () => answer }) },
      DB: { prepare: (sql: string) => statement(sql), batch },
    } as unknown as CloudflareEnvironment;
  }

  it.each(["start", "patch"] as const)("records the %s's state for the cook and recipe", async (operation) => {
    const batches: Array<Array<{ sql: string; values: unknown[] }>> = [];
    const env = recordingEnvironment(Response.json({ state }, { status: operation === "start" ? 201 : 200 }), async (statements) => {
      batches.push(statements);
      return statements.map(() => ({ results: [], meta: { changes: 1 } }));
    });

    const response = await handleCookSessionProtocolRequest(request(operation), env, "user-1", operation, { requireExpectedUser: true });

    expect(response.status).toBe(operation === "start" ? 201 : 200);
    expect(await response.json()).toEqual({ state });
    expect(batches).toHaveLength(1);
    const upsert = batches[0][1];
    expect(upsert.sql).toMatch(/INSERT INTO "CookingNow"/);
    expect(upsert.values.slice(0, 7)).toEqual(["user-1", "recipe-1", state.attemptId, 1, 0, "step-1", 0]);
    expect(upsert.values[9]).toBe(3);
  });

  it("records a state saved before steps were kept by id with no step id", async () => {
    const batches: Array<Array<{ sql: string; values: unknown[] }>> = [];
    const { activeStepId: _omitted, ...progress } = state.progress;
    const env = recordingEnvironment(Response.json({ state: { ...state, progress } }), async (statements) => {
      batches.push(statements);
      return statements.map(() => ({ results: [], meta: { changes: 1 } }));
    });

    await handleCookSessionProtocolRequest(request("patch"), env, "user-1", "patch", { requireExpectedUser: true });

    expect(batches[0][1].values[5]).toBeNull();
  });

  it.each([
    ["an error answer", Response.json({ error: { code: "stale_revision" } }, { status: 409 })],
    ["a body that is not JSON", new Response("not json", { status: 200 })],
    ["a body without a state", Response.json({ ok: true })],
    ["a state without progress lists", Response.json({ state: { ...state, progress: { activeStepIndex: 0 } } })],
    ["a state that is not an object", Response.json({ state: "active" })],
  ])("records nothing for %s and passes the answer through", async (_name, answer) => {
    const batch = vi.fn();
    const env = recordingEnvironment(answer.clone(), batch);

    const response = await handleCookSessionProtocolRequest(request("patch"), env, "user-1", "patch", { requireExpectedUser: true });

    expect(response.status).toBe(answer.status);
    expect(await response.text()).toBe(await answer.text());
    expect(batch).not.toHaveBeenCalled();
  });

  it("records nothing without a D1 binding that can batch", async () => {
    const { env } = environment(Response.json({ state }));

    const response = await handleCookSessionProtocolRequest(request("patch"), env, "user-1", "patch", { requireExpectedUser: true });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state });
  });

  it.each([
    ["D1 stays unavailable", new Error("D1_ERROR: Network connection lost."), true],
    ["the row cannot be written", new Error("FOREIGN KEY constraint failed"), false],
  ])("still answers the saved write when %s", async (_name, failure, unavailable) => {
    expectConsoleWarning(JSON.stringify({ event: "cooking_now_record_skipped", unavailable }));
    const env = recordingEnvironment(Response.json({ state }), async () => {
      throw failure;
    });

    const response = await handleCookSessionProtocolRequest(request("patch"), env, "user-1", "patch", { requireExpectedUser: true });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state });
  });
});

describe("cook-session calls that wait over a second", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A namespace whose object answers only when the test releases it. */
  function slowEnvironment(qaLogs: boolean) {
    const answers: Array<(response: Response) => void> = [];
    const env = {
      COOK_SESSIONS: {
        idFromName: () => "object-1",
        get: () => ({ fetch: () => new Promise<Response>((resolve) => answers.push(resolve)) }),
      },
      DB: { prepare: () => ({ bind() { return this; }, first: async () => ({ id: "recipe-1" }), all: async () => ({ results: [] }) }) },
      ...(qaLogs ? { SPOONJOY_QA_ERROR_LOGS: "1" } : {}),
    } as unknown as CloudflareEnvironment;
    return { env, answers };
  }

  it.each([
    ["detail", "read"],
    ["start", "write"],
  ] as const)("logs a %s still waiting on the object after a second, on a per-run QA Worker", async (operation, kind) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { env, answers } = slowEnvironment(true);

    const pending = handleCookSessionProtocolRequest(request(operation), env, "user-1", operation, { requireExpectedUser: true });
    expectConsoleWarning(JSON.stringify({
      event: "slow_call", call: "cook_session.fetch", operation: kind, table: null, attempt: 1, waitedMs: 1000, settled: false, outcome: null,
    }));
    await vi.advanceTimersByTimeAsync(1000);

    expectConsoleWarning(JSON.stringify({
      event: "slow_call", call: "cook_session.fetch", operation: kind, table: null, attempt: 1, waitedMs: 2900, settled: true, outcome: "ok",
    }));
    await vi.advanceTimersByTimeAsync(1900);
    answers[0](Response.json({ state: null }, { status: 404 }));
    expect((await pending).status).toBe(404);
  });

  it("logs a patch as a write, and runs no timer without the QA switch", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const quiet = slowEnvironment(false);
    void handleCookSessionProtocolRequest(request("detail"), quiet.env, "user-1", "detail", { requireExpectedUser: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(quiet.answers).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);

    const { env, answers } = slowEnvironment(true);
    void handleCookSessionProtocolRequest(request("patch"), env, "user-1", "patch", { requireExpectedUser: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(answers).toHaveLength(1);
    expectConsoleWarning(JSON.stringify({
      event: "slow_call", call: "cook_session.fetch", operation: "write", table: null, attempt: 1, waitedMs: 1000, settled: false, outcome: null,
    }));
    await vi.advanceTimersByTimeAsync(1000);
  });

  it("numbers the replayed read as the second try", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    let handles = 0;
    const answers: Array<(response: Response) => void> = [];
    const env = {
      COOK_SESSIONS: {
        idFromName: () => "object-1",
        get: () => ({
          fetch: () => handles++ === 0
            ? Promise.reject(storageReset())
            : new Promise<Response>((resolve) => answers.push(resolve)),
        }),
      },
      SPOONJOY_QA_ERROR_LOGS: "1",
    } as unknown as CloudflareEnvironment;

    expectConsoleWarning(replayed("cook_session.read"));
    const pending = handleCookSessionProtocolRequest(request(), env, "user-1", "detail", { requireExpectedUser: true });
    await vi.advanceTimersByTimeAsync(100);
    expectConsoleWarning(JSON.stringify({
      event: "slow_call", call: "cook_session.fetch", operation: "read", table: null, attempt: 2, waitedMs: 1000, settled: false, outcome: null,
    }));
    await vi.advanceTimersByTimeAsync(1000);
    expectConsoleWarning(JSON.stringify({
      event: "slow_call", call: "cook_session.fetch", operation: "read", table: null, attempt: 2, waitedMs: 1000, settled: true, outcome: "ok",
    }));
    answers[0](Response.json({ state: null }));
    expect((await pending).status).toBe(200);
  });
});
