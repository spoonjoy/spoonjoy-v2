// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { COOK_INTERNAL_ORIGIN, COOK_PROTOCOL_HEADER } from "../../workers/cook-session-protocol";
import { COOK_SESSION_SLOW_MS, CookSession } from "../../workers/cook-session";
import { expectConsoleWarning } from "../warning-policy";

// A per-run QA Worker times the object's own work: the cook route's handler and each setAlarm.
// The storage here answers the session reads from memory and lets the test decide when setAlarm
// settles.

const SESSION_TABLE_SQL = "CREATE TABLE session (active_step_id_index INTEGER)";

function fakeStorage() {
  let row: Record<string, unknown> | null = null;
  const alarms: Array<() => void> = [];
  const storage = {
    marker: "storage",
    sql: {
      exec(query: string, ...bindings: unknown[]) {
        if (query.startsWith("SELECT sql FROM sqlite_master")) return { toArray: () => (row ? [{ sql: SESSION_TABLE_SQL }] : []) };
        if (query.startsWith("INSERT INTO session")) {
          const [recipeId, attemptId, startedAt] = bindings as [string, string, number];
          row = {
            recipe_id: recipeId, attempt_id: attemptId, revision: 0, active_step_index: 0, active_step_id: null,
            scale_factor: 1, checked_ingredient_ids_json: "[]", checked_step_output_ids_json: "[]",
            started_at: startedAt, updated_at: startedAt,
          };
        }
        if (query.startsWith("SELECT recipe_id")) return { toArray: () => (row ? [row] : []) };
        return { toArray: () => [] };
      },
    },
    setAlarm: vi.fn(() => new Promise<void>((resolve) => alarms.push(resolve))),
    deleteAlarm: vi.fn(async () => {}),
    deleteAll: vi.fn(async () => {}),
  };
  return { storage, alarms };
}

function cookRequest(method: "GET" | "POST", suffix = "") {
  return new Request(`${COOK_INTERNAL_ORIGIN}/api/cook-sessions/recipe-1${suffix}`, {
    method,
    headers: { [COOK_PROTOCOL_HEADER]: "1" },
  });
}

function session(storage: ReturnType<typeof fakeStorage>["storage"], env: Record<string, string> = {}) {
  return new CookSession({ storage } as unknown as ConstructorParameters<typeof CookSession>[0], env as unknown as Env);
}

describe("the cook-session object's own timing", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports a start whose setAlarm, and so its handler, waits past the threshold, on a per-run QA Worker", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { storage, alarms } = fakeStorage();
    const object = session(storage, { SPOONJOY_QA_ERROR_LOGS: "1" });

    const started = object.fetch(cookRequest("POST", "/start"));
    await vi.advanceTimersByTimeAsync(0);
    expect(alarms).toHaveLength(1);

    for (const call of ["cook_session.handle", "cook_session.set_alarm"]) {
      expectConsoleWarning(JSON.stringify({
        event: "slow_call", call, operation: "write", table: null, attempt: 1, waitedMs: COOK_SESSION_SLOW_MS, settled: false, outcome: null,
      }));
    }
    await vi.advanceTimersByTimeAsync(COOK_SESSION_SLOW_MS);

    for (const call of ["cook_session.set_alarm", "cook_session.handle"]) {
      expectConsoleWarning(JSON.stringify({
        event: "slow_call", call, operation: "write", table: null, attempt: 1, waitedMs: 400, settled: true, outcome: "ok",
      }));
    }
    await vi.advanceTimersByTimeAsync(400 - COOK_SESSION_SLOW_MS);
    alarms[0]();

    const response = await started;
    expect(response.status).toBe(201);
    expect(storage.setAlarm).toHaveBeenCalledTimes(1);
  });

  it("reports a read as a read, and passes the rest of the storage through", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { storage } = fakeStorage();
    const object = session(storage, { SPOONJOY_QA_ERROR_LOGS: "1" });

    const response = await object.fetch(cookRequest("GET"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ state: null });
    expect(vi.getTimerCount()).toBe(0);
    // The probe route still reaches the real storage's other members through the object.
    const probe = await object.fetch(new Request(`${COOK_INTERNAL_ORIGIN}/api/cook-sessions/recipe-1/socket`, {
      headers: { [COOK_PROTOCOL_HEADER]: "1" },
    }));
    expect(probe.status).toBe(503);
  });

  it("runs no timer and hands the storage over unchanged without the QA switch", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { storage, alarms } = fakeStorage();
    const object = session(storage);

    const started = object.fetch(cookRequest("POST", "/start"));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    alarms[0]();

    expect((await started).status).toBe(201);
  });

  it("binds the storage's own methods when the timed storage passes them through", async () => {
    const { storage } = fakeStorage();
    const object = session(storage, { SPOONJOY_QA_ERROR_LOGS: "1" });
    const timed = (object as unknown as { cookStorage(): typeof storage }).cookStorage();

    await timed.deleteAll();
    expect(storage.deleteAll.mock.contexts[0]).toBe(storage);
    expect(timed.marker).toBe("storage");
    expect(timed.sql).toBe(storage.sql);
  });
});
