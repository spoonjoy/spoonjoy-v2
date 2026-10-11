// Recorded cook-session responses for the native app (spoonjoy/spoonjoy-apple), alongside the /api/v1
// recordings test/contracts/native-api-recordings.test.ts makes.
//
// The cook-session endpoints are served by the CookSession Durable Object, which only runs in the
// Workers runtime, and a Workers test cannot write files. So this test drives the real Worker
// (workers/app.ts, the bearer check, the D1 recipe checks and the Durable Object) with the requests
// the native app sends (spoonjoy-apple's CookSessionRequests), normalizes the responses the same way
// as the Node test, and:
//
// - compares them with the committed `cook-session-*` recordings, which it imports at build time; or
// - when refreshing, hands them to test/workers/helpers/native-recordings-reporter.ts (a Vitest
//   reporter, which runs in Node) through the test's metadata, and the reporter writes the files.
//
//   pnpm run test:native-recordings:refresh   # refreshes these, then the Node test's and index.json
//
// Every value is synthetic.
import { createExecutionContext, env, runInDurableObject } from "cloudflare:test";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { cookSessionObjectName } from "../../workers/cook-session-api";
import {
  COOK_SESSION_RECORDING_PREFIX,
  createRecordingNormalizer,
  type Recording,
} from "../contracts/native-api-recording-format";
import { applyRepositoryMigrations } from "./helpers/repository-migrations";

interface TestD1Statement {
  bind(...values: unknown[]): TestD1Statement;
  run(): Promise<unknown>;
}

interface TestD1Database {
  prepare(sql: string): TestD1Statement;
}

interface TestWorkerEnvironment {
  COOK_SESSIONS: DurableObjectNamespace;
  COOK_PROTOCOL_TEST_DB: TestD1Database;
}

const committedFiles = import.meta.glob("../fixtures/native-api-recordings/cook-session-*.json", {
  eager: true,
  import: "default",
}) as Record<string, Recording>;

const ORIGIN = "https://spoonjoy.test";
const AT = "2026-01-01T00:00:00.000Z";
// IDs in the shape Prisma's cuid() makes, so the shared normalizer replaces them with placeholders.
const USER = "cnativerecordchef00000001";
const RECIPE = "cnativerecordrecipe000001";
const STEPS = ["cnativerecordstep00000001", "cnativerecordstep00000002", "cnativerecordstep00000003"];
const INGREDIENT = "cnativerecordingred000001";
const STEP_OUTPUT = "cnativerecordoutput000001";
// An ingredient another device checked on a version of the recipe that had it; the server drops it.
const REMOVED_INGREDIENT = "cnativerecordremoved00001";
const UNIT = "cnativerecordunit00000001";
const INGREDIENT_REF = "cnativerecordingref000001";
const CREDENTIAL = "cnativerecordtoken0000001";
const TOKEN = "sj_native_cook_recordings_test";

function testEnvironment(): TestWorkerEnvironment {
  return env as unknown as TestWorkerEnvironment;
}

function database(): TestD1Database {
  return testEnvironment().COOK_PROTOCOL_TEST_DB;
}

function workerEnvironment(): CloudflareEnvironment {
  return { ...testEnvironment(), DB: database(), COOK_SESSION_PROTOCOL: "v1" } as unknown as CloudflareEnvironment;
}

async function tokenHash(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const recordings: Recording[] = [];
const normalizeRecordedValue = createRecordingNormalizer();

// The requests spoonjoy-apple's CookSessionRequests builds: a bearer token, no X-Spoonjoy-Cook-User
// header (the token names one chef), and Origin on writes.
async function record(
  name: string,
  endpoint: string,
  method: "GET" | "POST" | "PATCH",
  suffix: string,
  expectedStatus: number,
  body?: unknown,
) {
  const headers = new Headers({ Accept: "application/json", Authorization: `Bearer ${TOKEN}` });
  if (method !== "GET") headers.set("Origin", ORIGIN);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const worker = (await import("../../workers/app")).default;
  const response = await worker.fetch(
    new Request(`${ORIGIN}/api/cook-sessions/${RECIPE}${suffix}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    workerEnvironment(),
    createExecutionContext(),
  );
  const text = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(`${endpoint} answered ${response.status}, expected ${expectedStatus}: ${text.slice(0, 600)}`);
  }
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const parsed = JSON.parse(text);
  recordings.push({ name: `${COOK_SESSION_RECORDING_PREFIX}${name}`, endpoint, status: response.status, body: normalizeRecordedValue(parsed) });
  return parsed as { state?: { attemptId: string; revision: number; progress: Record<string, unknown> } };
}

const READ = "GET /api/cook-sessions/{recipeId}";
const START = "POST /api/cook-sessions/{recipeId}/start";
const PATCH = "PATCH /api/cook-sessions/{recipeId}";

async function recordCookSession() {
  await record("read-empty", READ, "GET", "", 200);
  const started = await record("start", START, "POST", "/start", 201);
  await record("start-resume", START, "POST", "/start", 200);
  // The native app names the step by index only; the server fills in the step's id.
  const written = await record("patch", PATCH, "PATCH", "", 200, {
    attemptId: started.state!.attemptId,
    expectedRevision: started.state!.revision,
    mutationId: "cm_cook_patch",
    changes: {
      activeStepIndex: 1,
      scaleFactor: 2,
      checkedIngredientIds: [INGREDIENT, REMOVED_INGREDIENT],
      checkedStepOutputIds: [STEP_OUTPUT],
    },
  });
  await record("read", READ, "GET", "", 200);
  await record("patch-stale-revision", PATCH, "PATCH", "", 409, {
    attemptId: started.state!.attemptId,
    expectedRevision: started.state!.revision,
    mutationId: "cm_cook_patch_stale",
    changes: { activeStepIndex: 2 },
  });
  return written;
}

describe("native cook-session recordings", () => {
  let written: Awaited<ReturnType<typeof recordCookSession>>;

  beforeAll(async () => {
    const db = database();
    await applyRepositoryMigrations(db as unknown as Parameters<typeof applyRepositoryMigrations>[0]);
    const run = (sql: string, ...values: unknown[]) => db.prepare(sql).bind(...values).run();
    await run('INSERT INTO "User" ("id", "email", "username", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)', USER, "native-cook-recordings@example.test", "native_cook_recordings", AT, AT);
    await run('INSERT INTO "Recipe" ("id", "title", "chefId", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)', RECIPE, "Lemon Pantry Pasta", USER, AT, AT);
    for (const [index, stepId] of STEPS.entries()) {
      await run('INSERT INTO "RecipeStep" ("id", "recipeId", "stepNum", "description", "updatedAt") VALUES (?, ?, ?, ?, ?)', stepId, RECIPE, index + 1, "Step", AT);
    }
    await run('INSERT INTO "Unit" ("id", "name", "updatedAt") VALUES (?, ?, ?)', UNIT, "native-cook-recordings-unit", AT);
    await run('INSERT INTO "IngredientRef" ("id", "name", "updatedAt") VALUES (?, ?, ?)', INGREDIENT_REF, "native-cook-recordings-spaghetti", AT);
    await run('INSERT INTO "Ingredient" ("id", "recipeId", "stepNum", "quantity", "unitId", "ingredientRefId", "updatedAt") VALUES (?, ?, 1, 200, ?, ?, ?)', INGREDIENT, RECIPE, UNIT, INGREDIENT_REF, AT);
    await run('INSERT INTO "StepOutputUse" ("id", "recipeId", "outputStepNum", "inputStepNum", "updatedAt") VALUES (?, ?, 1, 2, ?)', STEP_OUTPUT, RECIPE, AT);
    // The scopes native sign-in grants for cook progress.
    await run(
      'INSERT INTO "ApiCredential" ("id", "userId", "name", "tokenHash", "tokenPrefix", "scopes", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      CREDENTIAL, USER, "Native app", await tokenHash(TOKEN), TOKEN.slice(0, 12), "kitchen:read kitchen:write", AT, AT,
    );
    written = await recordCookSession();
  });

  afterAll(async () => {
    const namespace = testEnvironment().COOK_SESSIONS;
    await runInDurableObject(namespace.get(namespace.idFromName(cookSessionObjectName(USER, RECIPE))), async (_instance, state) => {
      state.storage.sql.exec("DROP TABLE IF EXISTS session");
      await state.storage.deleteAll();
      await state.storage.deleteAlarm();
    });
    const db = database();
    await db.prepare('DELETE FROM "Recipe" WHERE "id" = ?').bind(RECIPE).run();
    await db.prepare('DELETE FROM "ApiCredential" WHERE "id" = ?').bind(CREDENTIAL).run();
    await db.prepare('DELETE FROM "User" WHERE "id" = ?').bind(USER).run();
    await db.prepare('DELETE FROM "Unit" WHERE "id" = ?').bind(UNIT).run();
    await db.prepare('DELETE FROM "IngredientRef" WHERE "id" = ?').bind(INGREDIENT_REF).run();
  });

  it("records the current protocol: the step by id and index, without checks the recipe no longer has", () => {
    expect(written.state!.progress).toEqual({
      activeStepIndex: 1,
      activeStepId: STEPS[1],
      scaleFactor: 2,
      checkedIngredientIds: [INGREDIENT],
      checkedStepOutputIds: [STEP_OUTPUT],
    });
  });

  it("matches the committed recordings", ({ task }) => {
    if (inject("writeNativeApiRecordings")) {
      task.meta.nativeApiRecordings = recordings;
      return;
    }
    const committed = Object.fromEntries(Object.values(committedFiles).map((recording) => [recording.name, recording]));
    expect(Object.keys(committed).sort(), "The cook-session recordings changed. Run `pnpm run test:native-recordings:refresh`.")
      .toEqual(recordings.map(({ name }) => name).sort());
    for (const recording of recordings) {
      expect(recording, `${recording.name} changed. Run \`pnpm run test:native-recordings:refresh\` and copy the recordings to spoonjoy-apple.`)
        .toEqual(committed[recording.name]);
    }
  });
});
