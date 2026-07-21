import { SELF, createExecutionContext, env } from "cloudflare:test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { action as legacyApiAction } from "../../app/routes/api.$";
import { action as apiV1Action } from "../../app/routes/api.v1.$";

interface TestD1Statement {
  bind(...values: unknown[]): TestD1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

interface TestD1Database {
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

async function applyRepositoryMigrations() {
  for (const [, sql] of Object.entries(migrations).sort(([left], [right]) => left.localeCompare(right))) {
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
    "kitchen:read kitchen:write",
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
}

async function dropCutoverFence() {
  await executeStatement(`DROP TRIGGER IF EXISTS "${CUTOVER_INSERT_TRIGGER}"`);
  await executeStatement(`DROP TRIGGER IF EXISTS "${CUTOVER_DELETE_TRIGGER}"`);
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

function bearerHeaders(extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${TOKEN}`,
    ...extra,
  };
}

function routeContext() {
  return { cloudflare: { env, ctx: createExecutionContext() } };
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

async function executeFencedCookbookDelete(): Promise<unknown> {
  try {
    await database().prepare(`DELETE FROM "Cookbook" WHERE "id" = ?`).bind(COOKBOOK_ID).run();
    throw new Error("expected the D1 membership fence to abort the cookbook cascade");
  } catch (error) {
    return error;
  }
}

describe("saved recipe cutover through the deployed Worker and Wrangler D1", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    await applyRepositoryMigrations();
    await seedAdapterFixture();
  });

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await dropCutoverFence();
    await executeStatement(`DROP TRIGGER IF EXISTS "${PROBE_TRIGGER}"`);
    await executeStatement(`DROP TABLE IF EXISTS "${PROBE_TABLE}"`);
    consoleError.mockRestore();
  });

  afterAll(async () => {
    await dropCutoverFence();
  });

  it("maps a real D1 cascade-delete fence through the shared web adapter", async () => {
    await installCutoverFence();
    const beforeUpdatedAt = await cookbookUpdatedAt();
    const error = await executeFencedCookbookDelete();
    const { productActivationPendingWebResponse } = await import(
      "../../app/lib/saved-recipe-cutover.server"
    );
    const result = productActivationPendingWebResponse(error);
    const response = result as { data: unknown; init?: { status?: number; headers?: HeadersInit } | null };

    expect(String(error)).toContain(CUTOVER_TOKEN);
    expect(response.init?.status).toBe(503);
    expect(response.data).toEqual(webActivationPendingBody);
    const responseHeaders = new Headers(response.init?.headers);
    expect(responseHeaders.get("Retry-After")).toBe("1");
    expect(responseHeaders.get("Cache-Control")).toBe("private, no-store");
    expect(await membershipCount(LEGACY_RECIPE_ID)).toBe(1);
    expect(await cookbookUpdatedAt()).toBe(beforeUpdatedAt);
    expect(consoleError).not.toHaveBeenCalled();
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
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("maps a real D1 delete fence through legacy /api and preserves the membership", async () => {
    await installCutoverFence();

    const response = await legacyApiAction({
      request: new Request(
        `${TEST_ORIGIN}/api/cookbooks/${COOKBOOK_ID}/recipes/${LEGACY_RECIPE_ID}`,
        {
        method: "DELETE",
        headers: bearerHeaders({ "X-Request-Id": "req_cutover_d1_legacy" }),
        },
      ),
      params: { "*": `cookbooks/${COOKBOOK_ID}/recipes/${LEGACY_RECIPE_ID}` },
      context: routeContext(),
    } as any);

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
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("maps a real D1 insert fence through MCP HTTP and preserves JSON-RPC transport status", async () => {
    await installCutoverFence();

    const response = await SELF.fetch(new Request(`${TEST_ORIGIN}/mcp`, {
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
    }));

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
    expect(consoleError).not.toHaveBeenCalled();
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
});
