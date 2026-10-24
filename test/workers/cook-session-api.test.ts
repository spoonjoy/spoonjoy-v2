// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { handleCookSessionProtocolRequest } from "../../workers/cook-session-api";
import { expectConsoleWarning } from "../warning-policy";

const RESET_MESSAGE = "Internal error in Durable Object storage caused object to be reset";

function storageReset() {
  return Object.assign(new Error(RESET_MESSAGE), { retryable: true });
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

  it.each(["start", "patch"] as const)("never replays a %s write after a retryable failure", async (operation) => {
    const error = storageReset();
    const { env, get } = environment(error);

    await expect(handleCookSessionProtocolRequest(request(operation), env, "user-1", operation, { requireExpectedUser: true }))
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
