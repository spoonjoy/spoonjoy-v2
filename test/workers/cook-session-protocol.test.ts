import {
  createExecutionContext,
  env,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createUserSessionCookie } from "../../app/lib/session.server";
import { changesFitRecipe, cookSessionObjectName } from "../../workers/cook-session-api";
import { parseCookPatchBody } from "../../workers/cook-session-protocol";
import { COOK_SESSION_RETENTION_MS } from "../../workers/cook-session-store";
import { applyRepositoryMigrations } from "./helpers/repository-migrations";

interface TestD1Statement {
  bind(...values: unknown[]): TestD1Statement;
  run(): Promise<unknown>;
}

interface TestD1Database {
  exec(sql: string): Promise<unknown>;
  prepare(sql: string): TestD1Statement;
}

interface TestWorkerEnvironment {
  COOK_SESSIONS: DurableObjectNamespace;
  // This file's own D1 (wrangler.workers-test.json), migrated with the real schema, so it never
  // disturbs the hand-built tables other Workers-lane files keep in the shared DB binding.
  COOK_PROTOCOL_TEST_DB: TestD1Database;
}

interface CookStateBody {
  version: number;
  recipeId: string;
  attemptId: string;
  status: string;
  revision: number;
  progress: {
    activeStepIndex: number;
    scaleFactor: number;
    checkedIngredientIds: string[];
    checkedStepOutputIds: string[];
  };
  startedAt: string;
  updatedAt: string;
  terminalAt: null;
}

const TEST_ORIGIN = "https://spoonjoy.test";
const TEST_SESSION_SECRET = "spoonjoy-workers-cook-session-test-secret";
const USER_A = "cook-protocol-user-a";
const USER_B = "cook-protocol-user-b";
const WRITE_TOKEN = "sj_cook_protocol_write_test";
const RECIPE = "cook-protocol-recipe";
const EMPTY_RECIPE = "cook-protocol-empty-recipe";
const DELETED_RECIPE = "cook-protocol-deleted-recipe";
const RICE = "cook-protocol-rice";
const STOCK = "cook-protocol-stock";
const OTHER_INGREDIENT = "cook-protocol-other-ingredient";
const STEP_USE = "cook-protocol-use-1";
const UNIT = "cook-protocol-unit";
const INGREDIENT_REF = "cook-protocol-ingredient-ref";

function testEnvironment(): TestWorkerEnvironment {
  return env as unknown as TestWorkerEnvironment;
}

function database(): TestD1Database {
  return testEnvironment().COOK_PROTOCOL_TEST_DB;
}

function protocolEnvironment(overrides: Record<string, unknown> = {}): CloudflareEnvironment {
  return {
    ...testEnvironment(),
    DB: database(),
    COOK_SESSION_PROTOCOL: "v1",
    ...overrides,
  } as unknown as CloudflareEnvironment;
}

async function tokenHash(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sessionCookieFor(userId: string) {
  return (await createUserSessionCookie(
    userId,
    {
      DB: database() as unknown as D1Database,
      NODE_ENV: "test",
      SESSION_SECRET: TEST_SESSION_SECRET,
      SPOONJOY_BASE_URL: TEST_ORIGIN,
    },
    new Request(`${TEST_ORIGIN}/login`),
  )).split(";", 1)[0];
}

let cookieA = "";
let cookieB = "";

async function send(
  method: string,
  path: string,
  options: {
    body?: BodyInit;
    cookie?: string;
    environment?: CloudflareEnvironment;
    headers?: Record<string, string>;
  } = {},
) {
  const worker = (await import("../../workers/app")).default;
  const headers = new Headers(options.headers);
  headers.set("Cookie", options.cookie ?? cookieA);
  headers.set("Origin", TEST_ORIGIN);
  const suffix = path.length > 0 ? `/${path}` : "";
  return worker.fetch(
    new Request(`${TEST_ORIGIN}/api/cook-sessions${suffix}`, { method, headers, body: options.body }),
    options.environment ?? protocolEnvironment(),
    createExecutionContext(),
  );
}

async function stateOf(response: Response): Promise<CookStateBody> {
  return ((await response.json()) as { state: CookStateBody }).state;
}

async function startSession(recipeId = RECIPE, cookie = cookieA) {
  return stateOf(await send("POST", `${recipeId}/start`, { cookie }));
}

function patchBody(state: CookStateBody, changes: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    attemptId: state.attemptId,
    expectedRevision: state.revision,
    mutationId: crypto.randomUUID(),
    changes,
    ...overrides,
  });
}

async function patch(state: CookStateBody, changes: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return send("PATCH", RECIPE, { body: patchBody(state, changes, overrides) });
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const body = (await response.json()) as { error: { code: string; retryable: boolean; state?: CookStateBody } };
  expect(body.error.code).toBe(code);
  return body.error;
}

function objectFor(userId: string, recipeId = RECIPE) {
  const namespace = testEnvironment().COOK_SESSIONS;
  return namespace.get(namespace.idFromName(cookSessionObjectName(userId, recipeId)));
}

async function userTables(stub: DurableObjectStub) {
  return runInDurableObject(stub, (_instance, state) => Array.from(state.storage.sql.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_KV', '_cf_METADATA') ORDER BY name",
  )).map((row) => row.name));
}

async function resetObject(stub: DurableObjectStub) {
  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.sql.exec("DROP TABLE IF EXISTS session");
    await state.storage.deleteAll();
    await state.storage.deleteAlarm();
  });
}

describe("cook-session protocol v1", () => {
  beforeAll(async () => {
    const db = database();
    await applyRepositoryMigrations(db as unknown as Parameters<typeof applyRepositoryMigrations>[0]);
    const at = "2026-07-20T00:00:00.000Z";
    const run = (sql: string, ...values: unknown[]) => db.prepare(sql).bind(...values).run();
    for (const [id, name] of [[USER_A, "cook_protocol_a"], [USER_B, "cook_protocol_b"]]) {
      await run('INSERT INTO "User" ("id", "email", "username", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)', id, `${name}@example.com`, name, at, at);
    }
    for (const [id, deletedAt] of [[RECIPE, null], [EMPTY_RECIPE, null], [DELETED_RECIPE, at]]) {
      await run('INSERT INTO "Recipe" ("id", "title", "chefId", "createdAt", "updatedAt", "deletedAt") VALUES (?, ?, ?, ?, ?, ?)', id, id, USER_A, at, at, deletedAt);
    }
    for (const [recipeId, stepNum] of [[RECIPE, 1], [RECIPE, 2], [RECIPE, 3], [DELETED_RECIPE, 1]]) {
      await run('INSERT INTO "RecipeStep" ("id", "recipeId", "stepNum", "description", "updatedAt") VALUES (?, ?, ?, ?, ?)', `${recipeId}-step-${stepNum}`, recipeId, stepNum, "Step", at);
    }
    await run('INSERT INTO "Unit" ("id", "name", "updatedAt") VALUES (?, ?, ?)', UNIT, UNIT, at);
    await run('INSERT INTO "IngredientRef" ("id", "name", "updatedAt") VALUES (?, ?, ?)', INGREDIENT_REF, INGREDIENT_REF, at);
    for (const [id, recipeId] of [[RICE, RECIPE], [STOCK, RECIPE], [OTHER_INGREDIENT, DELETED_RECIPE]]) {
      await run('INSERT INTO "Ingredient" ("id", "recipeId", "stepNum", "quantity", "unitId", "ingredientRefId", "updatedAt") VALUES (?, ?, 1, 1, ?, ?, ?)', id, recipeId, UNIT, INGREDIENT_REF, at);
    }
    await run('INSERT INTO "StepOutputUse" ("id", "recipeId", "outputStepNum", "inputStepNum", "updatedAt") VALUES (?, ?, 1, 3, ?)', STEP_USE, RECIPE, at);
    await run(
      'INSERT INTO "ApiCredential" ("id", "userId", "name", "tokenHash", "tokenPrefix", "scopes", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      "cook-protocol-write", USER_B, "write", await tokenHash(WRITE_TOKEN), WRITE_TOKEN.slice(0, 12), "kitchen:read kitchen:write", at, at,
    );
    cookieA = await sessionCookieFor(USER_A);
    cookieB = await sessionCookieFor(USER_B);
  });

  afterAll(async () => {
    const db = database();
    for (const recipeId of [RECIPE, EMPTY_RECIPE, DELETED_RECIPE]) {
      await db.prepare('DELETE FROM "Recipe" WHERE "id" = ?').bind(recipeId).run();
    }
    await db.prepare('DELETE FROM "ApiCredential" WHERE "id" = ?').bind("cook-protocol-write").run();
    for (const userId of [USER_A, USER_B]) {
      await db.prepare('DELETE FROM "User" WHERE "id" = ?').bind(userId).run();
    }
    await db.prepare('DELETE FROM "Unit" WHERE "id" = ?').bind(UNIT).run();
    await db.prepare('DELETE FROM "IngredientRef" WHERE "id" = ?').bind(INGREDIENT_REF).run();
  });

  beforeEach(async () => {
    await resetObject(objectFor(USER_A));
    await resetObject(objectFor(USER_B));
    await resetObject(objectFor(USER_A, EMPTY_RECIPE));
  });

  it("answers a recipe the user has never cooked with a null state and leaves no storage", async () => {
    const response = await send("GET", RECIPE);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Spoonjoy-Worker-Version")).toBeTruthy();
    await expect(response.json()).resolves.toEqual({ state: null });
    await expect(userTables(objectFor(USER_A))).resolves.toEqual([]);
  });

  it("starts once, then resumes the same attempt", async () => {
    const created = await send("POST", `${RECIPE}/start`);
    expect(created.status).toBe(201);
    const first = await stateOf(created);
    expect(first).toMatchObject({
      version: 1,
      recipeId: RECIPE,
      status: "active",
      revision: 0,
      progress: { activeStepIndex: 0, scaleFactor: 1, checkedIngredientIds: [], checkedStepOutputIds: [] },
      terminalAt: null,
    });
    expect(first.startedAt).toBe(first.updatedAt);

    const resumed = await send("POST", `${RECIPE}/start`, { body: "{}" });
    expect(resumed.status).toBe(200);
    expect(await stateOf(resumed)).toEqual(first);
    await expect(userTables(objectFor(USER_A))).resolves.toEqual(["session"]);
  });

  it("writes progress as the next revision and serves it to another device of the same user", async () => {
    const started = await startSession();
    const response = await patch(started, {
      activeStepIndex: 2,
      scaleFactor: 1.5,
      checkedIngredientIds: [RICE],
      checkedStepOutputIds: [STEP_USE],
    });

    expect(response.status).toBe(200);
    const written = await stateOf(response);
    expect(written.revision).toBe(1);
    expect(written.attemptId).toBe(started.attemptId);
    expect(written.progress).toEqual({
      activeStepIndex: 2,
      scaleFactor: 1.5,
      checkedIngredientIds: [RICE],
      checkedStepOutputIds: [STEP_USE],
    });

    // The other device reads with the same session identity (a second cookie for the same user).
    const otherDevice = await send("GET", RECIPE, { cookie: await sessionCookieFor(USER_A) });
    expect(await stateOf(otherDevice)).toEqual(written);

    // A partial change keeps every other field.
    const cleared = await stateOf(await patch(written, { checkedIngredientIds: [] }));
    expect(cleared.revision).toBe(2);
    expect(cleared.progress).toEqual({ ...written.progress, checkedIngredientIds: [] });
  });

  it("keeps each user's progress separate", async () => {
    const started = await startSession();
    await patch(started, { checkedIngredientIds: [RICE] });

    await expect(send("GET", RECIPE, { cookie: cookieB }).then((response) => response.json()))
      .resolves.toEqual({ state: null });
  });

  it("serves bearer credentials under their own user", async () => {
    const headers = { Authorization: `Bearer ${WRITE_TOKEN}` };
    const worker = (await import("../../workers/app")).default;
    const started = await worker.fetch(
      new Request(`${TEST_ORIGIN}/api/cook-sessions/${RECIPE}/start`, {
        method: "POST",
        headers: { ...headers, Origin: TEST_ORIGIN },
      }),
      protocolEnvironment(),
      createExecutionContext(),
    );
    expect(started.status).toBe(201);

    await expect(send("GET", RECIPE, { cookie: cookieB }).then(stateOf))
      .resolves.toMatchObject({ revision: 0 });
    await expect(send("GET", RECIPE).then((response) => response.json())).resolves.toEqual({ state: null });
  });

  it("rejects a stale revision or attempt with the current state", async () => {
    const started = await startSession();
    const written = await stateOf(await patch(started, { scaleFactor: 2 }));

    const staleRevision = await expectError(await patch(started, { scaleFactor: 3 }), 409, "stale_revision");
    expect(staleRevision.state).toEqual(written);
    expect(staleRevision.retryable).toBe(false);

    const staleAttempt = await expectError(
      await patch(written, { scaleFactor: 3 }, { attemptId: "00000000-0000-4000-8000-000000000000" }),
      409,
      "stale_attempt",
    );
    expect(staleAttempt.state).toEqual(written);
    await expect(send("GET", RECIPE).then(stateOf)).resolves.toEqual(written);
  });

  it("returns not_found for progress written before a session starts", async () => {
    const neverStarted = {
      attemptId: "00000000-0000-4000-8000-000000000000",
      revision: 0,
    } as CookStateBody;

    await expectError(await patch(neverStarted, { scaleFactor: 2 }), 404, "not_found");
    await expect(userTables(objectFor(USER_A))).resolves.toEqual([]);
  });

  it("rejects progress that does not fit the recipe as it is now", async () => {
    const started = await startSession();

    for (const changes of [
      { checkedIngredientIds: [OTHER_INGREDIENT] },
      { checkedStepOutputIds: ["use-unknown"] },
      { activeStepIndex: 3 },
    ]) {
      await expectError(await patch(started, changes), 400, "invalid_request");
    }
    await expect(send("GET", RECIPE).then(stateOf)).resolves.toEqual(started);
  });

  it("allows step index 0 on a recipe without steps", async () => {
    const started = await startSession(EMPTY_RECIPE);
    const response = await send("PATCH", EMPTY_RECIPE, { body: patchBody(started, { activeStepIndex: 0 }) });

    expect(response.status).toBe(200);
    expect((await stateOf(response)).revision).toBe(1);
  });

  it("refuses a request made for a different user without reading or writing their session", async () => {
    const started = await startSession();
    await patch(started, { checkedIngredientIds: [RICE] });
    const before = await send("GET", RECIPE).then(stateOf);

    for (const [method, path, body] of [
      ["GET", RECIPE, undefined],
      ["POST", `${RECIPE}/start`, undefined],
      ["PATCH", RECIPE, patchBody(before, { scaleFactor: 3 })],
    ] as const) {
      const error = await expectError(
        await send(method, path, { body, headers: { "X-Spoonjoy-Cook-User": USER_B } }),
        412,
        "user_mismatch",
      );
      expect(error).toEqual({
        code: "user_mismatch",
        message: "This request was made for a different signed-in user.",
        retryable: false,
      });
    }

    await expect(send("GET", RECIPE).then(stateOf)).resolves.toEqual(before);
    await expect(send("GET", RECIPE, { cookie: cookieB }).then((response) => response.json())).resolves.toEqual({ state: null });
    const matching = await send("GET", RECIPE, { headers: { "X-Spoonjoy-Cook-User": USER_A } });
    expect(await stateOf(matching)).toEqual(before);
  });

  it("rejects malformed and oversized bodies before the Durable Object", async () => {
    const started = await startSession();

    await expectError(await send("PATCH", RECIPE, { body: "not json" }), 400, "invalid_request");
    await expectError(await send("POST", `${RECIPE}/start`, { body: "x" }), 400, "invalid_request");
    await expectError(
      await send("PATCH", RECIPE, { body: patchBody(started, { checkedIngredientIds: ["x".repeat(140_000)] }) }),
      400,
      "invalid_request",
    );
    const chunk = new TextEncoder().encode("x".repeat(70_000));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    await expectError(await send("PATCH", RECIPE, { body: stream }), 400, "invalid_request");
    await expectError(
      await send("PATCH", RECIPE, { body: "{}", headers: { "Content-Length": String(200_000) } }),
      400,
      "invalid_request",
    );
    await expect(send("GET", RECIPE).then(stateOf)).resolves.toEqual(started);
  });

  it("returns not_found for a missing, deleted, or malformed recipe", async () => {
    await expectError(await send("POST", "cook-protocol-missing/start"), 404, "not_found");
    await expectError(await send("POST", `${DELETED_RECIPE}/start`), 404, "not_found");
    await expectError(
      await send("PATCH", DELETED_RECIPE, {
        body: patchBody({ attemptId: "00000000-0000-4000-8000-000000000000", revision: 0 } as CookStateBody, { scaleFactor: 2 }),
      }),
      404,
      "not_found",
    );
    await expectError(await send("GET", "bad%20id"), 404, "not_found");
  });

  it("keeps unimplemented routes and a missing binding on the retryable 503", async () => {
    for (const [method, path] of [
      ["GET", ""],
      ["DELETE", RECIPE],
      ["POST", `${RECIPE}/complete`],
      ["POST", `${RECIPE}/abandon`],
      ["POST", `${RECIPE}/restart`],
      ["GET", `${RECIPE}/socket`],
    ]) {
      await expectError(await send(method, path), 503, "cook_session_protocol_unavailable");
    }

    const withoutNamespace = await send("GET", RECIPE, { environment: protocolEnvironment({ COOK_SESSIONS: undefined }) });
    expect(withoutNamespace.headers.get("Retry-After")).toBe("1");
    await expectError(withoutNamespace, 503, "cook_session_protocol_unavailable");
  });

  it("stays inert when the protocol flag is off", async () => {
    await expectError(
      await send("POST", `${RECIPE}/start`, { environment: protocolEnvironment({ COOK_SESSION_PROTOCOL: undefined }) }),
      503,
      "cook_session_protocol_unavailable",
    );
    await expect(userTables(objectFor(USER_A))).resolves.toEqual([]);
  });

  describe("Durable Object", () => {
    function internalRequest(method: string, suffix: string, body?: string) {
      return new Request(`https://cook-session.internal/api/cook-sessions/${RECIPE}${suffix}`, {
        method,
        headers: { "X-Spoonjoy-Cook-Protocol": "1" },
        body,
      });
    }

    it("validates PATCH bodies itself and ignores unknown internal routes", async () => {
      const stub = objectFor(USER_A);
      await expectError(await stub.fetch(internalRequest("PATCH", "", "{}")), 400, "invalid_request");
      expect((await stub.fetch(internalRequest("POST", ""))).status).toBe(404);
      expect((await stub.fetch(internalRequest("GET", "/unknown"))).status).toBe(404);
      expect((await stub.fetch(internalRequest("PUT", "/start"))).status).toBe(404);
      await expect(userTables(stub)).resolves.toEqual([]);
    });

    it("keeps an active session through its retention alarm and deletes it once idle", async () => {
      await startSession();
      const stub = objectFor(USER_A);
      const alarm = await runInDurableObject(stub, (_instance, state) => state.storage.getAlarm());
      expect(alarm).toBeGreaterThan(Date.now() + COOK_SESSION_RETENTION_MS - 60_000);

      // Still fresh: the alarm reschedules itself for the session's expiry.
      await runInDurableObject(stub, (_instance, state) => state.storage.setAlarm(Date.now() + 60_000));
      expect(await runDurableObjectAlarm(stub)).toBe(true);
      await expect(userTables(stub)).resolves.toEqual(["session"]);
      await expect(runInDurableObject(stub, (_instance, state) => state.storage.getAlarm())).resolves.toBeGreaterThan(Date.now());

      // Idle past retention: everything is deleted.
      await runInDurableObject(stub, async (_instance, state) => {
        state.storage.sql.exec("UPDATE session SET started_at = 0, updated_at = 0");
        await state.storage.setAlarm(Date.now() + 60_000);
      });
      expect(await runDurableObjectAlarm(stub)).toBe(true);
      await expect(userTables(stub)).resolves.toEqual([]);
      await expect(runInDurableObject(stub, (_instance, state) => state.storage.getAlarm())).resolves.toBeNull();
      await expect(send("GET", RECIPE).then((response) => response.json())).resolves.toEqual({ state: null });
    });

    it("clears an object whose alarm fires without a session", async () => {
      const stub = objectFor(USER_A);
      await runInDurableObject(stub, (_instance, state) => state.storage.setAlarm(Date.now() + 60_000));
      expect(await runDurableObjectAlarm(stub)).toBe(true);
      await expect(userTables(stub)).resolves.toEqual([]);
    });
  });

  describe("request validation", () => {
    const attemptId = "00000000-0000-4000-8000-000000000000";
    const valid = { attemptId, expectedRevision: 0, mutationId: "m-1", changes: { scaleFactor: 2 } };

    it("accepts exactly the four body fields and the four progress fields", () => {
      expect(parseCookPatchBody(JSON.stringify(valid))).toEqual(valid);
      expect(parseCookPatchBody(JSON.stringify({
        ...valid,
        changes: { activeStepIndex: 1, scaleFactor: 0.25, checkedIngredientIds: ["a"], checkedStepOutputIds: [] },
      }))?.changes).toEqual({ activeStepIndex: 1, scaleFactor: 0.25, checkedIngredientIds: ["a"], checkedStepOutputIds: [] });
    });

    it.each([
      ["not JSON", "{"],
      ["an array", "[]"],
      ["an extra key", JSON.stringify({ ...valid, extra: true })],
      ["a missing key", JSON.stringify({ attemptId, expectedRevision: 0, mutationId: "m", other: {} })],
      ["a malformed attempt", JSON.stringify({ ...valid, attemptId: "attempt" })],
      ["a negative revision", JSON.stringify({ ...valid, expectedRevision: -1 })],
      ["a fractional revision", JSON.stringify({ ...valid, expectedRevision: 0.5 })],
      ["a malformed mutation id", JSON.stringify({ ...valid, mutationId: "has space" })],
      ["non-object changes", JSON.stringify({ ...valid, changes: [] })],
      ["empty changes", JSON.stringify({ ...valid, changes: {} })],
      ["an unknown change", JSON.stringify({ ...valid, changes: { title: "x" } })],
      ["a negative step", JSON.stringify({ ...valid, changes: { activeStepIndex: -1 } })],
      ["a huge step", JSON.stringify({ ...valid, changes: { activeStepIndex: 10_001 } })],
      ["a string scale", JSON.stringify({ ...valid, changes: { scaleFactor: "2" } })],
      ["a tiny scale", JSON.stringify({ ...valid, changes: { scaleFactor: 0.2 } })],
      ["a huge scale", JSON.stringify({ ...valid, changes: { scaleFactor: 51 } })],
      ["a non-list ingredient set", JSON.stringify({ ...valid, changes: { checkedIngredientIds: "a" } })],
      ["duplicate ingredients", JSON.stringify({ ...valid, changes: { checkedIngredientIds: ["a", "a"] } })],
      ["an empty ingredient id", JSON.stringify({ ...valid, changes: { checkedIngredientIds: [""] } })],
      ["a numeric ingredient id", JSON.stringify({ ...valid, changes: { checkedIngredientIds: [1] } })],
      ["too many ingredients", JSON.stringify({ ...valid, changes: { checkedIngredientIds: Array.from({ length: 501 }, (_, i) => `i${i}`) } })],
      ["a bad step-output set", JSON.stringify({ ...valid, changes: { checkedStepOutputIds: [null] } })],
    ])("rejects %s", (_name, text) => {
      expect(parseCookPatchBody(text)).toBeNull();
    });

    it("checks the step index and ids against the recipe", () => {
      const bounds = { stepCount: 2, ingredientIds: new Set(["a"]), stepOutputIds: new Set(["u"]) };
      const body = (changes: Record<string, unknown>) => ({ ...valid, changes });

      expect(changesFitRecipe(body({ activeStepIndex: 1, checkedIngredientIds: ["a"], checkedStepOutputIds: ["u"] }), bounds)).toBe(true);
      expect(changesFitRecipe(body({ scaleFactor: 2 }), bounds)).toBe(true);
      expect(changesFitRecipe(body({ activeStepIndex: 2 }), bounds)).toBe(false);
    });
  });
});
