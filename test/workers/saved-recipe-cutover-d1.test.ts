import { SELF, createExecutionContext, env } from "cloudflare:test";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { action as legacyApiAction } from "../../app/routes/api.$";
import { action as apiV1Action } from "../../app/routes/api.v1.$";
import { handleRecipeDetailAction } from "../../app/lib/recipe-detail.server";
import { handleShoppingListAction } from "../../app/lib/shopping-list.server";
import { getRequestDb } from "../../app/lib/route-platform.server";
import { provisionSeedShoppingListItem } from "../../app/lib/shopping-list-seed-compat.server";
import { createUserSessionCookie } from "../../app/lib/session.server";
import { expectConsoleError, expectConsoleErrorMatching } from "../warning-policy";

interface TestD1Statement {
  bind(...values: unknown[]): TestD1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

interface TestD1Database {
  batch(statements: TestD1Statement[]): Promise<unknown>;
  exec(sql: string): Promise<unknown>;
  prepare(sql: string): TestD1Statement;
}

const migrations = import.meta.glob("../../migrations/*.sql", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>;

const TEST_ORIGIN = "https://spoonjoy.test";
const USER_ID = "cutover-d1-user";
const COOKBOOK_ID = "cutover-d1-cookbook";
const REST_RECIPE_ID = "cutover-d1-rest-recipe";
const LEGACY_RECIPE_ID = "cutover-d1-legacy-recipe";
const MCP_RECIPE_ID = "cutover-d1-mcp-recipe";
const LEGACY_MEMBERSHIP_ID = "cutover-d1-legacy-membership";
const TOKEN = "sj_cutover_d1_adapter_test";
const FIXTURE_TIMESTAMP = "2026-07-20T00:00:00.000Z";
const CUTOVER_INSERT_TRIGGER = "SavedRecipe_cutover_block_membership_insert";
const CUTOVER_DELETE_TRIGGER = "SavedRecipe_cutover_block_membership_delete";
const CUTOVER_TOKEN = "saved_recipe_cutover_pending";
const PRODUCT_ACTIVATION_PENDING_MESSAGE =
  "Spoonjoy product activation is still completing. Retry shortly.";
const PROBE_TABLE = "SavedRecipeCutoverRecognizerProbe";
const PROBE_TRIGGER = "SavedRecipeCutoverRecognizerProbe_abort";
const SHOPPING_LIST_ID = "cutover-d1-shopping-list";
const SHOPPING_UNIT_ID = "cutover-d1-shopping-unit";
const SHOPPING_FIRST_REF_ID = "cutover-d1-shopping-first-ref";
const SHOPPING_SECOND_REF_ID = "cutover-d1-shopping-second-ref";
const SHOPPING_ABORT_TRIGGER = "ShoppingListItem_atomic_batch_abort";
const COOKBOOK_ABORT_TRIGGER = "Cookbook_compatibility_batch_abort";

const webActivationPendingBody = {
  error: {
    code: "product_activation_pending",
    message: PRODUCT_ACTIVATION_PENDING_MESSAGE,
    retryable: true,
  },
};

function database() {
  return (env as unknown as { DB: TestD1Database }).DB;
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function applyRepositoryMigrations(options: { product?: boolean } = {}) {
  for (const [path, sql] of Object.entries(migrations).sort(([left], [right]) => left.localeCompare(right))) {
    const isProductMigration = path.endsWith("/0025_clem_feedback_product.sql");
    if (isProductMigration !== Boolean(options.product)) continue;
    for (const statement of splitMigrationStatements(sql)) {
      await database().prepare(statement).run();
    }
  }
}

function splitMigrationStatements(sql: string): string[] {
  const statements: string[] = [];
  let buffer = "";
  let inTrigger = false;

  for (const sourceLine of sql.split(/\r?\n/)) {
    if (/^\s*--/.test(sourceLine) || !sourceLine.trim()) continue;
    buffer += `${sourceLine}\n`;
    if (/^\s*CREATE\s+TRIGGER\b/i.test(buffer)) inTrigger = true;

    const statementComplete = inTrigger
      ? /^\s*END;\s*$/i.test(sourceLine)
      : /;\s*$/.test(sourceLine);
    if (!statementComplete) continue;

    statements.push(buffer.trim());
    buffer = "";
    inTrigger = false;
  }

  if (buffer.trim()) throw new Error("Repository migration ended with incomplete SQL");
  return statements;
}

async function executeStatement(sql: string) {
  await database().prepare(sql).run();
}

interface ShoppingIdentityMatrixRow {
  id: string;
  quantity: number | null;
  checked: number;
  updatedAt: string;
  checkedAt: string | null;
  deletedAt: string | null;
  sortIndex: number;
}

async function resetShoppingIdentityMatrix() {
  await executeStatement(`DELETE FROM "ShoppingListItem" WHERE "shoppingListId" = '${SHOPPING_LIST_ID}'`);
  await executeStatement(`
    INSERT INTO "ShoppingListItem" (
      "id", "shoppingListId", "quantity", "unitId", "ingredientRefId",
      "checked", "updatedAt", "checkedAt", "deletedAt", "sortIndex"
    ) VALUES
      (
        'matrix-first-tombstone', '${SHOPPING_LIST_ID}', 100,
        '${SHOPPING_UNIT_ID}', '${SHOPPING_FIRST_REF_ID}', 1,
        '${FIXTURE_TIMESTAMP}', '${FIXTURE_TIMESTAMP}', '${FIXTURE_TIMESTAMP}', 0
      ),
      (
        'matrix-first-active', '${SHOPPING_LIST_ID}', 5,
        '${SHOPPING_UNIT_ID}', '${SHOPPING_FIRST_REF_ID}', 0,
        '${FIXTURE_TIMESTAMP}', NULL, NULL, 4
      ),
      (
        'matrix-second-A', '${SHOPPING_LIST_ID}', 7,
        '${SHOPPING_UNIT_ID}', '${SHOPPING_SECOND_REF_ID}', 1,
        '${FIXTURE_TIMESTAMP}', '${FIXTURE_TIMESTAMP}', '${FIXTURE_TIMESTAMP}', 1
      ),
      (
        'matrix-second-a', '${SHOPPING_LIST_ID}', 20,
        '${SHOPPING_UNIT_ID}', '${SHOPPING_SECOND_REF_ID}', 1,
        '${FIXTURE_TIMESTAMP}', '${FIXTURE_TIMESTAMP}', '${FIXTURE_TIMESTAMP}', 1
      )
  `);
}

async function shoppingIdentityMatrixRow(id: string) {
  return database().prepare(`
    SELECT "id", "quantity", "checked", "updatedAt", "checkedAt", "deletedAt", "sortIndex"
    FROM "ShoppingListItem"
    WHERE "id" = ?
  `).bind(id).first<ShoppingIdentityMatrixRow>();
}

async function activeShoppingIdentityMatrixRow(ingredientRefId: string) {
  return database().prepare(`
    SELECT "id", "quantity", "checked", "updatedAt", "checkedAt", "deletedAt", "sortIndex"
    FROM "ShoppingListItem"
    WHERE "shoppingListId" = ?
      AND "ingredientRefId" = ?
      AND "unitId" = ?
      AND "deletedAt" IS NULL
  `).bind(
    SHOPPING_LIST_ID,
    ingredientRefId,
    SHOPPING_UNIT_ID,
  ).first<ShoppingIdentityMatrixRow>();
}

async function expectShoppingIdentityMatrix(
  label: string,
  firstDelta: number,
  secondDelta: number,
) {
  expect(await shoppingIdentityMatrixRow("matrix-first-active"), label).toMatchObject({
    id: "matrix-first-active",
    quantity: 5 + firstDelta,
    checked: 0,
    checkedAt: null,
    deletedAt: null,
    sortIndex: 4,
  });
  expect(await shoppingIdentityMatrixRow("matrix-first-tombstone"), label).toMatchObject({
    id: "matrix-first-tombstone",
    quantity: 100,
    checked: 1,
    updatedAt: FIXTURE_TIMESTAMP,
    checkedAt: FIXTURE_TIMESTAMP,
    deletedAt: FIXTURE_TIMESTAMP,
    sortIndex: 0,
  });
  const freshSecond = await activeShoppingIdentityMatrixRow(SHOPPING_SECOND_REF_ID);
  expect(freshSecond, label).toMatchObject({
    quantity: secondDelta,
    checked: 0,
    checkedAt: null,
    deletedAt: null,
    sortIndex: 5,
  });
  expect(freshSecond?.id, label).not.toBe("matrix-second-A");
  expect(freshSecond?.id, label).not.toBe("matrix-second-a");
  expect(await shoppingIdentityMatrixRow("matrix-second-A"), label).toMatchObject({
    id: "matrix-second-A",
    quantity: 7,
    checked: 1,
    updatedAt: FIXTURE_TIMESTAMP,
    checkedAt: FIXTURE_TIMESTAMP,
    deletedAt: FIXTURE_TIMESTAMP,
    sortIndex: 1,
  });
  expect(await shoppingIdentityMatrixRow("matrix-second-a"), label).toMatchObject({
    id: "matrix-second-a",
    quantity: 20,
    checked: 1,
    updatedAt: FIXTURE_TIMESTAMP,
    checkedAt: FIXTURE_TIMESTAMP,
    deletedAt: FIXTURE_TIMESTAMP,
    sortIndex: 1,
  });
}

async function expectD1AdapterError<T>(
  expectedMessage: RegExp,
  run: () => Promise<T>,
): Promise<T> {
  let observedError: Error | undefined;
  expectConsoleErrorMatching(
    `Prisma D1 performIO error matching ${expectedMessage}`,
    (args) => {
      const error = args[1];
      if (
        args[0] !== "Error in performIO: %O" ||
        !(error instanceof Error) ||
        !expectedMessage.test(error.message)
      ) {
        return false;
      }
      observedError = error;
      return true;
    },
  );
  const result = await run();
  expect(observedError).toBeInstanceOf(Error);
  return result;
}

async function seedAdapterFixture() {
  const db = database();
  await db.prepare(`
    INSERT INTO "User" ("id", "email", "username", "createdAt", "updatedAt")
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    USER_ID,
    "cutover-d1@example.com",
    "cutover_d1_user",
    FIXTURE_TIMESTAMP,
    FIXTURE_TIMESTAMP,
  ).run();
  await db.prepare(`
    INSERT INTO "ApiCredential" (
      "id", "userId", "name", "tokenHash", "tokenPrefix", "scopes", "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    "cutover-d1-credential",
    USER_ID,
    "Cutover D1 adapter credential",
    await hashToken(TOKEN),
    TOKEN.slice(0, 12),
    "kitchen:read kitchen:write shopping_list:write",
    FIXTURE_TIMESTAMP,
    FIXTURE_TIMESTAMP,
  ).run();
  await db.prepare(`
    INSERT INTO "Cookbook" ("id", "title", "authorId", "createdAt", "updatedAt")
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    COOKBOOK_ID,
    "Cutover D1 Cookbook",
    USER_ID,
    FIXTURE_TIMESTAMP,
    FIXTURE_TIMESTAMP,
  ).run();

  for (const [id, title] of [
    [REST_RECIPE_ID, "Cutover D1 REST Recipe"],
    [LEGACY_RECIPE_ID, "Cutover D1 Legacy Recipe"],
    [MCP_RECIPE_ID, "Cutover D1 MCP Recipe"],
  ]) {
    await db.prepare(`
      INSERT INTO "Recipe" ("id", "title", "chefId", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, title, USER_ID, FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP).run();
  }

  await db.prepare(`
    INSERT INTO "RecipeInCookbook" (
      "id", "cookbookId", "recipeId", "addedById", "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    LEGACY_MEMBERSHIP_ID,
    COOKBOOK_ID,
    LEGACY_RECIPE_ID,
    USER_ID,
    FIXTURE_TIMESTAMP,
    FIXTURE_TIMESTAMP,
  ).run();

  await db.prepare(`
    INSERT INTO "ShoppingList" ("id", "authorId", "createdAt", "updatedAt")
    VALUES (?, ?, ?, ?)
  `).bind(SHOPPING_LIST_ID, USER_ID, FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP).run();
  await db.prepare(`INSERT INTO "Unit" ("id", "name", "updatedAt") VALUES (?, ?, ?)`)
    .bind(SHOPPING_UNIT_ID, "cutover d1 each", FIXTURE_TIMESTAMP).run();
  await db.prepare(`INSERT INTO "IngredientRef" ("id", "name", "updatedAt") VALUES (?, ?, ?)`)
    .bind(SHOPPING_FIRST_REF_ID, "cutover d1 apples", FIXTURE_TIMESTAMP).run();
  await db.prepare(`INSERT INTO "IngredientRef" ("id", "name", "updatedAt") VALUES (?, ?, ?)`)
    .bind(SHOPPING_SECOND_REF_ID, "cutover d1 flour", FIXTURE_TIMESTAMP).run();
  await db.prepare(`
    INSERT INTO "RecipeStep" (
      "id", "recipeId", "stepNum", "stepTitle", "description", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    "cutover-d1-shopping-step",
    REST_RECIPE_ID,
    1,
    "Gather",
    "Gather the atomic D1 ingredients.",
    FIXTURE_TIMESTAMP,
  ).run();
  await db.prepare(`
    INSERT INTO "Ingredient" (
      "id", "recipeId", "stepNum", "quantity", "unitId", "ingredientRefId", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    "cutover-d1-shopping-ingredient-a",
    REST_RECIPE_ID,
    1,
    2,
    SHOPPING_UNIT_ID,
    SHOPPING_FIRST_REF_ID,
    FIXTURE_TIMESTAMP,
  ).run();
  await db.prepare(`
    INSERT INTO "Ingredient" (
      "id", "recipeId", "stepNum", "quantity", "unitId", "ingredientRefId", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    "cutover-d1-shopping-ingredient-z",
    REST_RECIPE_ID,
    1,
    3,
    SHOPPING_UNIT_ID,
    SHOPPING_SECOND_REF_ID,
    FIXTURE_TIMESTAMP,
  ).run();
}

async function dropCutoverFence() {
  await executeStatement(`DROP TRIGGER IF EXISTS "${CUTOVER_INSERT_TRIGGER}"`);
  await executeStatement(`DROP TRIGGER IF EXISTS "${CUTOVER_DELETE_TRIGGER}"`);
}

async function dropShoppingAbortTrigger() {
  await executeStatement(`DROP TRIGGER IF EXISTS "${SHOPPING_ABORT_TRIGGER}"`);
}

async function dropCookbookAbortTrigger() {
  await executeStatement(`DROP TRIGGER IF EXISTS "${COOKBOOK_ABORT_TRIGGER}"`);
}

async function installCookbookAbortTrigger() {
  await dropCookbookAbortTrigger();
  await executeStatement(`
    CREATE TRIGGER "${COOKBOOK_ABORT_TRIGGER}"
    BEFORE UPDATE OF "updatedAt" ON "Cookbook"
    WHEN OLD."id" = '${COOKBOOK_ID}'
    BEGIN
      SELECT RAISE(ABORT, '${CUTOVER_TOKEN}');
    END
  `);
}

async function installCutoverFence(message = CUTOVER_TOKEN) {
  await dropCutoverFence();
  await executeStatement(`
    CREATE TRIGGER "${CUTOVER_INSERT_TRIGGER}"
    BEFORE INSERT ON "RecipeInCookbook"
    BEGIN
      SELECT RAISE(ABORT, '${message}');
    END
  `);
  await executeStatement(`
    CREATE TRIGGER "${CUTOVER_DELETE_TRIGGER}"
    BEFORE DELETE ON "RecipeInCookbook"
    BEGIN
      SELECT RAISE(ABORT, '${message}');
    END
  `);
}

async function membershipCount(recipeId: string) {
  const row = await database().prepare(`
    SELECT COUNT(*) AS "count"
    FROM "RecipeInCookbook"
    WHERE "cookbookId" = ? AND "recipeId" = ?
  `).bind(COOKBOOK_ID, recipeId).first<{ count: number }>();
  return row?.count ?? -1;
}

async function cookbookUpdatedAt() {
  const row = await database().prepare(`
    SELECT "updatedAt" FROM "Cookbook" WHERE "id" = ?
  `).bind(COOKBOOK_ID).first<{ updatedAt: string }>();
  return row?.updatedAt ?? null;
}

async function idempotencyReservationCount(clientMutationId: string) {
  const row = await database().prepare(`
    SELECT COUNT(*) AS "count"
    FROM "ApiIdempotencyKey"
    WHERE "userId" = ? AND "key" = ?
  `).bind(USER_ID, clientMutationId).first<{ count: number }>();
  return row?.count ?? -1;
}

async function tombstoneCount() {
  const row = await database().prepare(`
    SELECT COUNT(*) AS "count"
    FROM "NativeSyncTombstone"
    WHERE "accountId" = ? AND "resourceType" = 'cookbook' AND "resourceId" = ?
  `).bind(USER_ID, COOKBOOK_ID).first<{ count: number }>();
  return row?.count ?? -1;
}

async function cookbookTitleCount(title: string) {
  const row = await database().prepare(`
    SELECT COUNT(*) AS "count"
    FROM "Cookbook"
    WHERE "authorId" = ? AND "title" = ?
  `).bind(USER_ID, title).first<{ count: number }>();
  return row?.count ?? -1;
}

function bearerHeaders(extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${TOKEN}`,
    ...extra,
  };
}

function routeContext(databaseOverride?: TestD1Database) {
  const routeEnv = databaseOverride
    ? new Proxy(env as object, {
        get(target, property, receiver) {
          return property === "DB"
            ? databaseOverride
            : Reflect.get(target, property, receiver);
        },
      })
    : env;
  return { cloudflare: { env: routeEnv, ctx: createExecutionContext() } };
}

async function expectRetryHeaders(response: Response) {
  expect(response.headers.get("Retry-After")).toBe("1");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
}

async function installProbeTrigger(message: string) {
  await executeStatement(`DROP TRIGGER IF EXISTS "${PROBE_TRIGGER}"`);
  await executeStatement(`DROP TABLE IF EXISTS "${PROBE_TABLE}"`);
  await executeStatement(`CREATE TABLE "${PROBE_TABLE}" ("id" INTEGER PRIMARY KEY)`);
  await executeStatement(`
    CREATE TRIGGER "${PROBE_TRIGGER}"
    BEFORE INSERT ON "${PROBE_TABLE}"
    BEGIN
      SELECT RAISE(ABORT, '${message}');
    END
  `);
}

async function executeFencedProbeInsert(): Promise<unknown> {
  try {
    await database().prepare(`INSERT INTO "${PROBE_TABLE}" ("id") VALUES (1)`).run();
    throw new Error("expected the D1 trigger to abort");
  } catch (error) {
    return error;
  }
}

describe("saved recipe cutover through the deployed Worker and Wrangler D1", () => {
  beforeAll(async () => {
    await applyRepositoryMigrations();
    await seedAdapterFixture();
    await applyRepositoryMigrations({ product: true });
    await dropCutoverFence();
  });

  afterEach(async () => {
    await dropCutoverFence();
    await dropShoppingAbortTrigger();
    await dropCookbookAbortTrigger();
    await executeStatement(`DELETE FROM "ShoppingListItem" WHERE "shoppingListId" = '${SHOPPING_LIST_ID}'`);
    await executeStatement(`DROP TRIGGER IF EXISTS "${PROBE_TRIGGER}"`);
    await executeStatement(`DROP TABLE IF EXISTS "${PROBE_TABLE}"`);
  });

  afterAll(async () => {
    await dropCutoverFence();
  });

  it("rolls back a native D1 tombstone when the REST cookbook delete fails second", async () => {
    await installCutoverFence();
    const beforeUpdatedAt = await cookbookUpdatedAt();
    const requestId = "req_cutover_d1_delete_second";
    const clientMutationId = "cm_cutover_d1_delete_second";
    const response = await apiV1Action({
      request: new Request(`${TEST_ORIGIN}/api/v1/cookbooks/${COOKBOOK_ID}`, {
        method: "DELETE",
        headers: bearerHeaders({
          "Content-Type": "application/json",
          "X-Request-Id": requestId,
        }),
        body: JSON.stringify({ clientMutationId }),
      }),
      params: { "*": `cookbooks/${COOKBOOK_ID}` },
      context: routeContext(),
    } as any);

    expect(response.status).toBe(503);
    await expectRetryHeaders(response);
    expect(await membershipCount(LEGACY_RECIPE_ID)).toBe(1);
    expect(await cookbookUpdatedAt()).toBe(beforeUpdatedAt);
    expect(await tombstoneCount()).toBe(0);
    expect(await idempotencyReservationCount(clientMutationId)).toBe(0);
  });

  it("rolls back a newly created cookbook when its native D1 membership fails second", async () => {
    await installCutoverFence();
    const title = "Cutover D1 Rolled Back Cookbook";
    const cookie = await createUserSessionCookie(
      USER_ID,
      env as unknown as { SESSION_SECRET?: string },
      new Request(`${TEST_ORIGIN}/recipes/${REST_RECIPE_ID}`),
    );
    const formData = new FormData();
    formData.set("intent", "createCookbookAndSave");
    formData.set("title", title);

    const result = await handleRecipeDetailAction({
      request: new Request(`${TEST_ORIGIN}/recipes/${REST_RECIPE_ID}`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { id: REST_RECIPE_ID },
      context: routeContext(),
    } as any);
    const response = result as { data: unknown; init?: { status?: number } | null };

    expect(response.init?.status).toBe(503);
    expect(response.data).toEqual(webActivationPendingBody);
    expect(await cookbookTitleCount(title)).toBe(0);
    expect(await membershipCount(REST_RECIPE_ID)).toBe(0);
  });

  it("rolls back a native D1 REST membership when the cookbook touch fails second", async () => {
    await installCookbookAbortTrigger();
    const requestId = "req_cutover_d1_rest_second";
    const clientMutationId = "cm_cutover_d1_rest_second";
    const beforeUpdatedAt = await cookbookUpdatedAt();

    const response = await apiV1Action({
      request: new Request(
        `${TEST_ORIGIN}/api/v1/cookbooks/${COOKBOOK_ID}/recipes/${REST_RECIPE_ID}`,
        {
          method: "POST",
          headers: bearerHeaders({
            "Content-Type": "application/json",
            "X-Request-Id": requestId,
          }),
          body: JSON.stringify({ clientMutationId }),
        },
      ),
      params: { "*": `cookbooks/${COOKBOOK_ID}/recipes/${REST_RECIPE_ID}` },
      context: routeContext(),
    } as any);

    expect(response.status).toBe(503);
    await expectRetryHeaders(response);
    expect(await membershipCount(REST_RECIPE_ID)).toBe(0);
    expect(await cookbookUpdatedAt()).toBe(beforeUpdatedAt);
    expect(await idempotencyReservationCount(clientMutationId)).toBe(0);
  });

  it("restores a native D1 membership when the first-party web cookbook touch fails second", async () => {
    await installCookbookAbortTrigger();
    const cookie = await createUserSessionCookie(
      USER_ID,
      env as unknown as { SESSION_SECRET?: string },
      new Request(`${TEST_ORIGIN}/recipes/${LEGACY_RECIPE_ID}`),
    );
    const formData = new FormData();
    formData.set("intent", "removeFromCookbook");
    formData.set("cookbookId", COOKBOOK_ID);

    const result = await handleRecipeDetailAction({
      request: new Request(`${TEST_ORIGIN}/recipes/${LEGACY_RECIPE_ID}`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { id: LEGACY_RECIPE_ID },
      context: routeContext(),
    } as any);
    const response = result as { data: unknown; init?: { status?: number } | null };

    expect(response.init?.status).toBe(503);
    expect(response.data).toEqual(webActivationPendingBody);
    expect(await membershipCount(LEGACY_RECIPE_ID)).toBe(1);
  });

  it("maps a real D1 insert fence through REST v1 and releases the rolled-back mutation id", async () => {
    await installCutoverFence();
    const requestId = "req_cutover_d1_rest";
    const clientMutationId = "cm_cutover_d1_rest";
    const beforeUpdatedAt = await cookbookUpdatedAt();

    const response = await apiV1Action({
      request: new Request(
        `${TEST_ORIGIN}/api/v1/cookbooks/${COOKBOOK_ID}/recipes/${REST_RECIPE_ID}`,
        {
        method: "POST",
        headers: bearerHeaders({
          "Content-Type": "application/json",
          "X-Request-Id": requestId,
        }),
        body: JSON.stringify({ clientMutationId }),
        },
      ),
      params: { "*": `cookbooks/${COOKBOOK_ID}/recipes/${REST_RECIPE_ID}` },
      context: routeContext(),
    } as any);

    expect(response.status).toBe(503);
    await expectRetryHeaders(response);
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain("Retry-After");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      requestId,
      error: {
        code: "product_activation_pending",
        message: PRODUCT_ACTIVATION_PENDING_MESSAGE,
        status: 503,
        details: { retryAfterSeconds: 1 },
      },
    });
    expect(await membershipCount(REST_RECIPE_ID)).toBe(0);
    expect(await cookbookUpdatedAt()).toBe(beforeUpdatedAt);
    expect(await idempotencyReservationCount(clientMutationId)).toBe(0);
  });

  it("maps a real D1 delete fence through legacy /api and preserves the membership", async () => {
    await installCutoverFence();

    const response = await expectD1AdapterError(/saved_recipe_cutover_pending/, () => legacyApiAction({
      request: new Request(
        `${TEST_ORIGIN}/api/cookbooks/${COOKBOOK_ID}/recipes/${LEGACY_RECIPE_ID}`,
        {
        method: "DELETE",
        headers: bearerHeaders({ "X-Request-Id": "req_cutover_d1_legacy" }),
        },
      ),
      params: { "*": `cookbooks/${COOKBOOK_ID}/recipes/${LEGACY_RECIPE_ID}` },
      context: routeContext(),
    } as any));

    expect(response.status).toBe(503);
    await expectRetryHeaders(response);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        message: PRODUCT_ACTIVATION_PENDING_MESSAGE,
        status: 503,
      },
    });
    expect(await membershipCount(LEGACY_RECIPE_ID)).toBe(1);
  });

  it("maps a real D1 insert fence through MCP HTTP and preserves JSON-RPC transport status", async () => {
    await installCutoverFence();

    const response = await expectD1AdapterError(/saved_recipe_cutover_pending/, () => SELF.fetch(new Request(`${TEST_ORIGIN}/mcp`, {
      method: "POST",
      headers: bearerHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 91,
        method: "tools/call",
        params: {
          name: "add_recipe_to_cookbook",
          arguments: { cookbookId: COOKBOOK_ID, recipeId: MCP_RECIPE_ID },
        },
      }),
    })));

    expect(response.status).toBe(200);
    await expectRetryHeaders(response);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: 91,
      error: {
        code: -32001,
        message: PRODUCT_ACTIVATION_PENDING_MESSAGE,
        data: {
          code: "product_activation_pending",
          retryable: true,
          retryAfterSeconds: 1,
        },
      },
    });
    expect(await membershipCount(MCP_RECIPE_ID)).toBe(0);
  });

  it("recognizes the exact token through the real D1 error wrapper", async () => {
    await installProbeTrigger(CUTOVER_TOKEN);
    const error = await executeFencedProbeInsert();
    const { isSavedRecipeCutoverPendingError } = await import(
      "../../app/lib/saved-recipe-cutover.server"
    );

    expect(String(error)).toContain(CUTOVER_TOKEN);
    expect(isSavedRecipeCutoverPendingError(error)).toBe(true);
  });

  it("rejects an identifier-suffixed near miss through the real D1 error wrapper", async () => {
    await installProbeTrigger(`${CUTOVER_TOKEN}_suffix`);
    const error = await executeFencedProbeInsert();
    const { isSavedRecipeCutoverPendingError } = await import(
      "../../app/lib/saved-recipe-cutover.server"
    );

    expect(String(error)).toContain(`${CUTOVER_TOKEN}_suffix`);
    expect(isSavedRecipeCutoverPendingError(error)).toBe(false);
  });

  it("rolls back the second native D1 REST shopping write and safely retries the mutation id", async () => {
    await executeStatement(`
      CREATE TRIGGER "${SHOPPING_ABORT_TRIGGER}"
      BEFORE INSERT ON "ShoppingListItem"
      WHEN NEW."ingredientRefId" = '${SHOPPING_SECOND_REF_ID}'
      BEGIN
        SELECT RAISE(ABORT, 'shopping_bulk_atomic_failure');
      END
    `);
    const clientMutationId = "cm_cutover_d1_shopping_atomic";
    const request = (requestId: string) => new Request(
      `${TEST_ORIGIN}/api/v1/shopping-list/add-from-recipe`,
      {
        method: "POST",
        headers: bearerHeaders({
          "Content-Type": "application/json",
          "X-Request-Id": requestId,
        }),
        body: JSON.stringify({
          clientMutationId,
          recipeId: REST_RECIPE_ID,
        }),
      },
    );
    const blockedRequestId = "req_cutover_d1_shopping_blocked";
    const nativeBatchError = new Error("shopping_bulk_atomic_failure");
    const realDatabase = database();
    const wrappedDatabase: TestD1Database = {
      exec: realDatabase.exec.bind(realDatabase),
      prepare: realDatabase.prepare.bind(realDatabase),
      async batch(statements) {
        try {
          return await realDatabase.batch(statements);
        } catch {
          throw nativeBatchError;
        }
      },
    };
    expectConsoleError(
      "[api-v1] internal_error",
      {
        requestId: blockedRequestId,
        method: "POST",
        path: "/api/v1/shopping-list/add-from-recipe",
        error: {
          name: nativeBatchError.name,
          message: nativeBatchError.message,
          stack: nativeBatchError.stack,
        },
      },
    );
    const blocked = await apiV1Action({
      request: request(blockedRequestId),
      params: { "*": "shopping-list/add-from-recipe" },
      context: routeContext(wrappedDatabase),
    } as any);

    expect(blocked.status).toBe(500);
    await expect(blocked.json()).resolves.toEqual({
      ok: false,
      requestId: blockedRequestId,
      error: {
        code: "internal_error",
        message: "Internal error",
        status: 500,
      },
    });
    const blockedRow = await database().prepare(`
      SELECT COUNT(*) AS "count"
      FROM "ShoppingListItem"
      WHERE "shoppingListId" = ?
    `).bind(SHOPPING_LIST_ID).first<{ count: number }>();
    expect(blockedRow?.count).toBe(0);
    expect(await idempotencyReservationCount(clientMutationId)).toBe(0);

    await dropShoppingAbortTrigger();
    const retryRequestId = "req_cutover_d1_shopping_retry";
    const retry = await apiV1Action({
      request: request(retryRequestId),
      params: { "*": "shopping-list/add-from-recipe" },
      context: routeContext(),
    } as any);

    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({
      ok: true,
      requestId: retryRequestId,
      data: {
        created: 2,
        updated: 0,
        items: expect.arrayContaining([
          expect.objectContaining({ quantity: 2 }),
          expect.objectContaining({ quantity: 3 }),
        ]),
      },
    });
    const retriedRow = await database().prepare(`
      SELECT COUNT(*) AS "count"
      FROM "ShoppingListItem"
      WHERE "shoppingListId" = ?
    `).bind(SHOPPING_LIST_ID).first<{ count: number }>();
    expect(retriedRow?.count).toBe(2);
    expect(await idempotencyReservationCount(clientMutationId)).toBe(1);
  });

  it("runs all six compatibility writers across both post-0025 identity states before activation", async () => {
    await installCutoverFence();
    expect(await database().prepare(`
      SELECT COUNT(*) AS "count"
      FROM sqlite_master
      WHERE type = 'trigger'
        AND name IN ('${CUTOVER_INSERT_TRIGGER}', '${CUTOVER_DELETE_TRIGGER}')
    `).first<{ count: number }>()).toEqual({ count: 2 });
    expect(await database().prepare(`
      SELECT COUNT(*) AS "count"
      FROM sqlite_master
      WHERE type = 'index' AND name = 'ShoppingListItem_active_identity_key'
    `).first<{ count: number }>()).toEqual({ count: 1 });
    expect(await database().prepare(`
      SELECT COUNT(*) AS "count"
      FROM sqlite_master
      WHERE type = 'index'
        AND name = 'ShoppingListItem_shoppingListId_unitId_ingredientRefId_key'
    `).first<{ count: number }>()).toEqual({ count: 0 });

    const cookie = await createUserSessionCookie(
      USER_ID,
      env as unknown as { SESSION_SECRET?: string },
      new Request(`${TEST_ORIGIN}/shopping-list`),
    );
    let requestNumber = 0;
    const nextRequestId = (label: string) => `req_matrix_${label}_${++requestNumber}`;
    const callWebManual = async (name: string, quantity: number) => {
      const formData = new FormData();
      formData.set("intent", "addItem");
      formData.set("ingredientName", name);
      formData.set("unitName", "cutover d1 each");
      formData.set("quantity", String(quantity));
      const result = await handleShoppingListAction({
        request: new Request(`${TEST_ORIGIN}/shopping-list`, {
          method: "POST",
          headers: { Cookie: cookie },
          body: formData,
        }),
        context: routeContext() as any,
      });
      expect(result).toMatchObject({ data: { success: true } });
    };
    const callRestManual = async (name: string, quantity: number, expectedStatus: number) => {
      const requestId = nextRequestId("rest_manual");
      const response = await apiV1Action({
        request: new Request(`${TEST_ORIGIN}/api/v1/shopping-list/items`, {
          method: "POST",
          headers: bearerHeaders({
            "Content-Type": "application/json",
            "X-Request-Id": requestId,
          }),
          body: JSON.stringify({
            clientMutationId: requestId,
            name,
            unit: "cutover d1 each",
            quantity,
          }),
        }),
        params: { "*": "shopping-list/items" },
        context: routeContext(),
      } as any);
      expect(response.status).toBe(expectedStatus);
    };
    const callMcp = async (
      id: number,
      name: "add_shopping_list_item" | "add_recipe_to_shopping_list",
      args: Record<string, unknown>,
    ) => {
      const response = await SELF.fetch(new Request(`${TEST_ORIGIN}/mcp`, {
        method: "POST",
        headers: bearerHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      }));
      expect(response.status).toBe(200);
      const body = await response.json() as { error?: unknown };
      expect(body.error).toBeUndefined();
    };
    const callWebRecipe = async () => {
      const formData = new FormData();
      formData.set("intent", "addFromRecipe");
      formData.set("recipeId", REST_RECIPE_ID);
      formData.set("scaleFactor", "1");
      const result = await handleShoppingListAction({
        request: new Request(`${TEST_ORIGIN}/shopping-list`, {
          method: "POST",
          headers: { Cookie: cookie },
          body: formData,
        }),
        context: routeContext() as any,
      });
      expect(result).toMatchObject({ data: { success: true } });
    };
    const callRestRecipe = async () => {
      const requestId = nextRequestId("rest_recipe");
      const response = await apiV1Action({
        request: new Request(`${TEST_ORIGIN}/api/v1/shopping-list/add-from-recipe`, {
          method: "POST",
          headers: bearerHeaders({
            "Content-Type": "application/json",
            "X-Request-Id": requestId,
          }),
          body: JSON.stringify({
            clientMutationId: requestId,
            recipeId: REST_RECIPE_ID,
          }),
        }),
        params: { "*": "shopping-list/add-from-recipe" },
        context: routeContext(),
      } as any);
      expect(response.status).toBe(200);
    };

    const scenarios = [
      {
        label: "web addItem",
        firstDelta: 3,
        secondDelta: 4,
        run: async () => {
          await callWebManual("cutover d1 apples", 3);
          await callWebManual("cutover d1 flour", 4);
        },
      },
      {
        label: "REST handleShoppingItemCreate",
        firstDelta: 3,
        secondDelta: 4,
        run: async () => {
          await callRestManual("cutover d1 apples", 3, 200);
          await callRestManual("cutover d1 flour", 4, 201);
        },
      },
      {
        label: "shared addShoppingListItemTool",
        firstDelta: 3,
        secondDelta: 4,
        run: async () => {
          await callMcp(201, "add_shopping_list_item", {
            name: "cutover d1 apples",
            unit: "cutover d1 each",
            quantity: 3,
          });
          await callMcp(202, "add_shopping_list_item", {
            name: "cutover d1 flour",
            unit: "cutover d1 each",
            quantity: 4,
          });
        },
      },
      {
        label: "web addFromRecipe",
        firstDelta: 2,
        secondDelta: 3,
        run: callWebRecipe,
      },
      {
        label: "REST handleShoppingAddFromRecipe",
        firstDelta: 2,
        secondDelta: 3,
        run: callRestRecipe,
      },
      {
        label: "shared addRecipeToShoppingListTool",
        firstDelta: 2,
        secondDelta: 3,
        run: () => callMcp(203, "add_recipe_to_shopping_list", {
          recipeId: REST_RECIPE_ID,
        }),
      },
    ];

    for (const scenario of scenarios) {
      await resetShoppingIdentityMatrix();
      await scenario.run();
      await expectShoppingIdentityMatrix(
        scenario.label,
        scenario.firstDelta,
        scenario.secondDelta,
      );
    }
  });

  it("recovers a real Prisma-D1 expression-index race inside seed provisioning", async () => {
    const db = await getRequestDb(routeContext() as any);
    let observedConflict: unknown;
    let injected = false;
    const create = db.shoppingListItem.create.bind(db.shoppingListItem);
    const shoppingListItem = new Proxy(db.shoppingListItem, {
      get(target, property) {
        if (property !== "create") return Reflect.get(target, property, target);
        return async (args: Parameters<typeof db.shoppingListItem.create>[0]) => {
          if (!injected) {
            injected = true;
            await create({
              data: {
                id: "cutover-d1-real-race-winner",
                shoppingListId: SHOPPING_LIST_ID,
                ingredientRefId: SHOPPING_FIRST_REF_ID,
                unitId: SHOPPING_UNIT_ID,
                quantity: 4,
                sortIndex: 0,
              },
            });
          }
          try {
            return await create(args);
          } catch (error) {
            observedConflict = error;
            throw error;
          }
        };
      },
    });
    const racingDb = new Proxy(db, {
      get(target, property) {
        if (property === "shoppingListItem") return shoppingListItem;
        return Reflect.get(target, property, target);
      },
    });
    const result = await expectD1AdapterError(
      /ShoppingListItem_active_identity_key/,
      () => provisionSeedShoppingListItem(racingDb, {
        shoppingListId: SHOPPING_LIST_ID,
        ingredientRefId: SHOPPING_FIRST_REF_ID,
        unitId: SHOPPING_UNIT_ID,
        quantity: 3,
        checked: false,
        checkedAt: null,
        deletedAt: null,
        categoryKey: null,
        iconKey: null,
        sortIndex: 1,
      }),
    );

    expect(observedConflict).toMatchObject({
      code: "P2002",
      meta: { target: ["index 'ShoppingListItem_active_identity_key'"] },
    });
    expect(result).toMatchObject({
      id: "cutover-d1-real-race-winner",
      quantity: 3,
      sortIndex: 1,
    });
    expect(await database().prepare(`
      SELECT COUNT(*) AS "count"
      FROM "ShoppingListItem"
      WHERE "shoppingListId" = ?
    `).bind(SHOPPING_LIST_ID).first<{ count: number }>()).toEqual({ count: 1 });
  });

  it("uses the same atomic native D1 recipe batch through MCP", async () => {
    await executeStatement(`
      CREATE TRIGGER "${SHOPPING_ABORT_TRIGGER}"
      BEFORE INSERT ON "ShoppingListItem"
      WHEN NEW."ingredientRefId" = '${SHOPPING_SECOND_REF_ID}'
      BEGIN
        SELECT RAISE(ABORT, 'shopping_bulk_atomic_failure');
      END
    `);
    const request = (id: number) => new Request(`${TEST_ORIGIN}/mcp`, {
      method: "POST",
      headers: bearerHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: "add_recipe_to_shopping_list",
          arguments: { recipeId: REST_RECIPE_ID },
        },
      }),
    });

    const blocked = await SELF.fetch(request(101));
    expect(blocked.status).toBe(200);
    await expect(blocked.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 101,
      error: { code: -32602 },
    });
    const blockedRow = await database().prepare(`
      SELECT COUNT(*) AS "count"
      FROM "ShoppingListItem"
      WHERE "shoppingListId" = ?
    `).bind(SHOPPING_LIST_ID).first<{ count: number }>();
    expect(blockedRow?.count).toBe(0);

    await dropShoppingAbortTrigger();
    const retry = await SELF.fetch(request(102));
    expect(retry.status).toBe(200);
    const retryBody = await retry.json() as {
      result?: { content?: Array<{ text?: string }> };
    };
    const toolResult = JSON.parse(retryBody.result?.content?.[0]?.text ?? "null");
    expect(toolResult).toMatchObject({ created: 2, updated: 0 });
    const retriedRow = await database().prepare(`
      SELECT COUNT(*) AS "count"
      FROM "ShoppingListItem"
      WHERE "shoppingListId" = ?
    `).bind(SHOPPING_LIST_ID).first<{ count: number }>();
    expect(retriedRow?.count).toBe(2);
  });

  it("uses the same atomic native D1 recipe batch through the first-party web action", async () => {
    await executeStatement(`
      CREATE TRIGGER "${SHOPPING_ABORT_TRIGGER}"
      BEFORE INSERT ON "ShoppingListItem"
      WHEN NEW."ingredientRefId" = '${SHOPPING_SECOND_REF_ID}'
      BEGIN
        SELECT RAISE(ABORT, 'shopping_bulk_atomic_failure');
      END
    `);
    const cookie = await createUserSessionCookie(
      USER_ID,
      env as unknown as { SESSION_SECRET?: string },
      new Request(`${TEST_ORIGIN}/shopping-list`),
    );
    const request = () => {
      const formData = new FormData();
      formData.set("intent", "addFromRecipe");
      formData.set("recipeId", REST_RECIPE_ID);
      formData.set("scaleFactor", "1");
      return new Request(`${TEST_ORIGIN}/shopping-list`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      });
    };

    await expect(handleShoppingListAction({
      request: request(),
      context: routeContext() as any,
    })).rejects.toThrow("shopping_bulk_atomic_failure");
    const blockedRow = await database().prepare(`
      SELECT COUNT(*) AS "count"
      FROM "ShoppingListItem"
      WHERE "shoppingListId" = ?
    `).bind(SHOPPING_LIST_ID).first<{ count: number }>();
    expect(blockedRow?.count).toBe(0);

    await dropShoppingAbortTrigger();
    const retry = await handleShoppingListAction({
      request: request(),
      context: routeContext() as any,
    });
    expect(retry).toMatchObject({ data: { success: true } });
    const retriedRow = await database().prepare(`
      SELECT COUNT(*) AS "count"
      FROM "ShoppingListItem"
      WHERE "shoppingListId" = ?
    `).bind(SHOPPING_LIST_ID).first<{ count: number }>();
    expect(retriedRow?.count).toBe(2);
  });
});
