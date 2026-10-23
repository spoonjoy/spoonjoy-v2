// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { handleCookSessionProtocolRequest } from "../../workers/cook-session-api";

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
    const state = { revision: 7, progress: { scaleFactor: 2 } };
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
