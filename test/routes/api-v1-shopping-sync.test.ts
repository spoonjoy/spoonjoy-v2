import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { action, loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { resolveApiV1ScopeRequirement } from "~/lib/api-v1.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser, getOrCreateIngredientRef, getOrCreateUnit } from "../utils";

function routeArgs(request: Request, splat: string) {
  return { request, params: { "*": splat }, context: { cloudflare: { env: null } } } as any;
}

async function readJson(response: Response) {
  return await response.json() as any;
}

function syncCursor(value: unknown) {
  return `v1.${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
}

function expectEnvelopeHeaders(response: Response, requestId: string) {
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(response.headers.get("X-Request-Id")).toBe(requestId);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type, X-Request-Id, X-Client-Mutation-Id");
  expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, PATCH, PUT, DELETE, OPTIONS");
  expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id, Retry-After");
}

function expectExactKeys(value: Record<string, unknown>, keys: string[]) {
  expect(Object.keys(value).sort()).toEqual([...keys].sort());
}

function expectSuccessEnvelope(payload: any, requestId: string) {
  expectExactKeys(payload, ["ok", "requestId", "data"]);
  expect(payload.ok).toBe(true);
  expect(payload.requestId).toBe(requestId);
}

function expectErrorEnvelope(payload: any, requestId: string, code: string, status: number) {
  expectExactKeys(payload, ["ok", "requestId", "error"]);
  expect(payload).toMatchObject({
    ok: false,
    requestId,
    error: { code, status },
  });
}

function expectShoppingListShape(list: any) {
  expectExactKeys(list, ["id", "chef", "items", "updatedAt"]);
  expectExactKeys(list.chef, ["id", "username"]);
  expect(typeof list.id).toBe("string");
  expect(typeof list.chef.id).toBe("string");
  expect(typeof list.chef.username).toBe("string");
  expect(Array.isArray(list.items)).toBe(true);
  expect(typeof list.updatedAt).toBe("string");
}

function expectShoppingItemShape(item: any) {
  expectExactKeys(item, [
    "id",
    "name",
    "quantity",
    "unit",
    "checked",
    "checkedAt",
    "deletedAt",
    "categoryKey",
    "iconKey",
    "sortIndex",
    "updatedAt",
  ]);
  expect(typeof item.id).toBe("string");
  expect(typeof item.name).toBe("string");
  expect(typeof item.checked).toBe("boolean");
  expect(typeof item.sortIndex).toBe("number");
  expect(typeof item.updatedAt).toBe("string");
  expect(item.quantity === null || typeof item.quantity === "number").toBe(true);
  for (const key of ["unit", "checkedAt", "deletedAt", "categoryKey", "iconKey"]) {
    expect(item[key] === null || typeof item[key] === "string").toBe(true);
  }
}

async function createShoppingFixture(db: Awaited<ReturnType<typeof getLocalDb>>) {
  const user = await db.user.create({ data: createTestUser() });
  const credential = await createApiCredential(db, user.id, "Shopping reader", { scopes: ["shopping_list:read"] });
  const legacyCredential = await createApiCredential(db, user.id, "Legacy shopping reader", { scopes: ["kitchen:read"] });
  const writeOnlyCredential = await createApiCredential(db, user.id, "Shopping writer only", { scopes: ["shopping_list:write"] });
  const list = await db.shoppingList.create({ data: { authorId: user.id } });
  const unit = await getOrCreateUnit(db, `unit ${faker.string.alphanumeric(6)}`);
  const activeRef = await getOrCreateIngredientRef(db, `active item ${faker.string.alphanumeric(6)}`);
  const deletedRef = await getOrCreateIngredientRef(db, `deleted item ${faker.string.alphanumeric(6)}`);
  const checkedAt = new Date();
  const active = await db.shoppingListItem.create({
    data: {
      shoppingListId: list.id,
      ingredientRefId: activeRef.id,
      unitId: unit.id,
      quantity: 2,
      checked: true,
      checkedAt,
      sortIndex: 2,
      categoryKey: "dairy",
      iconKey: "milk",
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const deletedAt = new Date();
  const tombstone = await db.shoppingListItem.create({
    data: {
      shoppingListId: list.id,
      ingredientRefId: deletedRef.id,
      quantity: 1,
      checked: false,
      deletedAt,
      sortIndex: 1,
      categoryKey: null,
      iconKey: null,
    },
  });

  return { user, credential, legacyCredential, writeOnlyCredential, list, unit, activeRef, deletedRef, checkedAt, active, tombstone };
}

async function createRecipeWithIngredients(
  db: Awaited<ReturnType<typeof getLocalDb>>,
  chefId: string,
  ingredients: Array<{ name: string; quantity: number; unit: string }>,
) {
  const recipe = await db.recipe.create({ data: createTestRecipe(chefId) });
  await db.recipeStep.create({
    data: {
      recipeId: recipe.id,
      stepNum: 1,
      stepTitle: "Gather",
      description: "Gather ingredients.",
    },
  });

  for (const ingredient of ingredients) {
    const unit = await getOrCreateUnit(db, ingredient.unit);
    const ingredientRef = await getOrCreateIngredientRef(db, ingredient.name);
    await db.ingredient.create({
      data: {
        recipeId: recipe.id,
        stepNum: 1,
        quantity: ingredient.quantity,
        unitId: unit.id,
        ingredientRefId: ingredientRef.id,
      },
    });
  }

  return recipe;
}

describe("API v1 shopping-list read and sync", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("declares read scope rows for list and sync endpoints", () => {
    expect(resolveApiV1ScopeRequirement("GET", "shopping-list")).toEqual({
      auth: "bearer",
      scopes: ["shopping_list:read"],
    });
    expect(resolveApiV1ScopeRequirement("GET", "shopping-list/sync")).toEqual({
      auth: "bearer",
      scopes: ["shopping_list:read"],
    });
    expect(resolveApiV1ScopeRequirement("POST", "shopping-list/add-from-recipe")).toEqual({
      auth: "bearer",
      scopes: ["shopping_list:write"],
    });
    expect(resolveApiV1ScopeRequirement("POST", "shopping-list/clear-completed")).toEqual({
      auth: "bearer",
      scopes: ["shopping_list:write"],
    });
    expect(resolveApiV1ScopeRequirement("POST", "shopping-list/clear-all")).toEqual({
      auth: "bearer",
      scopes: ["shopping_list:write"],
    });
  });

  it("returns the authenticated shopping list with active items and next cursor", async () => {
    const fixture = await createShoppingFixture(db);

    const response = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/shopping-list", {
      headers: { Authorization: `Bearer ${fixture.credential.token}`, "X-Request-Id": "req_shopping_list" },
    }) as unknown as Request, "shopping-list"));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expectEnvelopeHeaders(response, "req_shopping_list");
    expectSuccessEnvelope(payload, "req_shopping_list");
    expectExactKeys(payload.data, ["shoppingList", "nextCursor"]);
    expectShoppingListShape(payload.data.shoppingList);
    expect(payload).toMatchObject({
      ok: true,
      requestId: "req_shopping_list",
      data: {
        shoppingList: {
          id: fixture.list.id,
          chef: { id: fixture.user.id, username: fixture.user.username },
          items: [{
            id: fixture.active.id,
            name: fixture.activeRef.name,
            quantity: 2,
            unit: fixture.unit.name,
            checked: true,
            checkedAt: fixture.checkedAt.toISOString(),
            deletedAt: null,
            categoryKey: "dairy",
            iconKey: "milk",
            sortIndex: 2,
            updatedAt: expect.any(String),
          }],
          updatedAt: expect.any(String),
        },
        nextCursor: expect.any(String),
      },
    });
    expect(payload.data.shoppingList.items).toHaveLength(1);
    expect(payload.data.shoppingList.items.map((item: { id: string }) => item.id)).not.toContain(fixture.tombstone.id);
    expectShoppingItemShape(payload.data.shoppingList.items[0]);
    expect(payload.data.nextCursor).toBe(payload.data.shoppingList.items[0].updatedAt);

    const legacy = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/shopping-list", {
      headers: { Authorization: `Bearer ${fixture.legacyCredential.token}`, "X-Request-Id": "req_shopping_list_legacy" },
    }) as unknown as Request, "shopping-list"));
    expect(legacy.status).toBe(200);
  });

  it("returns an empty shopping list for a chef with no items", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "Empty shopping reader", { scopes: ["shopping_list:read"] });

    const response = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/shopping-list", {
      headers: { Authorization: `Bearer ${credential.token}`, "X-Request-Id": "req_shopping_empty" },
    }) as unknown as Request, "shopping-list"));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expectEnvelopeHeaders(response, "req_shopping_empty");
    expectSuccessEnvelope(payload, "req_shopping_empty");
    expectExactKeys(payload.data, ["shoppingList", "nextCursor"]);
    expectShoppingListShape(payload.data.shoppingList);
    expect(payload).toMatchObject({
      ok: true,
      requestId: "req_shopping_empty",
      data: {
        shoppingList: {
          id: expect.any(String),
          chef: { id: user.id, username: user.username },
          items: [],
          updatedAt: expect.any(String),
        },
        nextCursor: expect.any(String),
      },
    });
    expect(payload.data.nextCursor).toBe(payload.data.shoppingList.updatedAt);

    const sync = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/shopping-list/sync", {
      headers: { Authorization: `Bearer ${credential.token}`, "X-Request-Id": "req_shopping_empty_sync" },
    }) as unknown as Request, "shopping-list/sync"));
    const syncPayload = await readJson(sync);

    expect(sync.status).toBe(200);
    expectSuccessEnvelope(syncPayload, "req_shopping_empty_sync");
    expectExactKeys(syncPayload.data, ["items", "nextCursor", "hasMore"]);
    expect(syncPayload.data.items).toEqual([]);
    expect(syncPayload.data.hasMore).toBe(false);
    expect(syncPayload.data.nextCursor).toBe(payload.data.shoppingList.updatedAt);
  });

  it("syncs active items and tombstones, filters by cursor, and reports hasMore false", async () => {
    const fixture = await createShoppingFixture(db);

    const all = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/shopping-list/sync", {
      headers: { Authorization: `Bearer ${fixture.credential.token}`, "X-Request-Id": "req_shopping_sync_all" },
    }) as unknown as Request, "shopping-list/sync"));
    const allPayload = await readJson(all);

    expect(all.status).toBe(200);
    expectEnvelopeHeaders(all, "req_shopping_sync_all");
    expectSuccessEnvelope(allPayload, "req_shopping_sync_all");
    expectExactKeys(allPayload.data, ["items", "nextCursor", "hasMore"]);
    expect(allPayload).toMatchObject({
      ok: true,
      requestId: "req_shopping_sync_all",
      data: {
        items: expect.any(Array),
        nextCursor: expect.any(String),
        hasMore: false,
      },
    });
    expect(allPayload.data.items.map((item: { id: string }) => item.id)).toEqual([fixture.active.id, fixture.tombstone.id]);
    expect(allPayload.data.items.find((item: { id: string }) => item.id === fixture.tombstone.id)).toMatchObject({
      id: fixture.tombstone.id,
      name: fixture.deletedRef.name,
      quantity: 1,
      unit: null,
      checked: false,
      deletedAt: fixture.tombstone.deletedAt?.toISOString(),
      sortIndex: 1,
    });
    for (const item of allPayload.data.items) {
      expectShoppingItemShape(item);
    }
    expect(allPayload.data.nextCursor).toMatch(/^v1\./);

    const cursor = encodeURIComponent(allPayload.data.nextCursor);
    const filtered = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/shopping-list/sync?cursor=${cursor}`, {
      headers: { Authorization: `Bearer ${fixture.credential.token}`, "X-Request-Id": "req_shopping_sync_cursor" },
    }) as unknown as Request, "shopping-list/sync"));
    const filteredPayload = await readJson(filtered);

    expect(filtered.status).toBe(200);
    expectEnvelopeHeaders(filtered, "req_shopping_sync_cursor");
    expectSuccessEnvelope(filteredPayload, "req_shopping_sync_cursor");
    expectExactKeys(filteredPayload.data, ["items", "nextCursor", "hasMore"]);
    expect(filteredPayload.data.items).toEqual([]);
    expect(filteredPayload.data.hasMore).toBe(false);
    expect(filteredPayload.data.nextCursor).toBe(allPayload.data.nextCursor);

    const limited = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/shopping-list/sync?limit=1", {
      headers: { Authorization: `Bearer ${fixture.credential.token}`, "X-Request-Id": "req_shopping_sync_limited" },
    }) as unknown as Request, "shopping-list/sync"));
    const limitedPayload = await readJson(limited);

    expect(limited.status).toBe(200);
    expectSuccessEnvelope(limitedPayload, "req_shopping_sync_limited");
    expectExactKeys(limitedPayload.data, ["items", "nextCursor", "hasMore"]);
    expect(limitedPayload.data.items.map((item: { id: string }) => item.id)).toEqual([fixture.active.id]);
    expect(limitedPayload.data.nextCursor).toMatch(/^v1\./);
    expect(limitedPayload.data.hasMore).toBe(true);

    const limitedNext = await loader(routeArgs(new UndiciRequest(
      `http://localhost/api/v1/shopping-list/sync?limit=1&cursor=${encodeURIComponent(limitedPayload.data.nextCursor)}`,
      { headers: { Authorization: `Bearer ${fixture.credential.token}`, "X-Request-Id": "req_shopping_sync_limited_next" } },
    ) as unknown as Request, "shopping-list/sync"));
    const limitedNextPayload = await readJson(limitedNext);

    expect(limitedNext.status).toBe(200);
    expectSuccessEnvelope(limitedNextPayload, "req_shopping_sync_limited_next");
    expect(limitedNextPayload.data.items.map((item: { id: string }) => item.id)).toEqual([fixture.tombstone.id]);
    expect(limitedNextPayload.data.hasMore).toBe(false);
  });

  it("uses deterministic sync ordering and cursor fallbacks", async () => {
    const fixture = await createShoppingFixture(db);
    const tiedAt = new Date(Date.now() - 60_000);
    await db.shoppingListItem.updateMany({
      where: { id: { in: [fixture.active.id, fixture.tombstone.id] } },
      data: { updatedAt: tiedAt },
    });

    const tied = await loader(routeArgs(new UndiciRequest(
      `http://localhost/api/v1/shopping-list/sync?cursor=${encodeURIComponent(new Date(tiedAt.getTime() - 1_000).toISOString())}`,
      { headers: { Authorization: `Bearer ${fixture.credential.token}`, "X-Request-Id": "req_shopping_sync_tied" } },
    ) as unknown as Request, "shopping-list/sync"));
    const tiedPayload = await readJson(tied);
    const expectedTiedOrder = [fixture.active.id, fixture.tombstone.id].sort();

    expect(tied.status).toBe(200);
    expectSuccessEnvelope(tiedPayload, "req_shopping_sync_tied");
    expectExactKeys(tiedPayload.data, ["items", "nextCursor", "hasMore"]);
    expect(tiedPayload.data.items.map((item: { id: string }) => item.id)).toEqual(expectedTiedOrder);
    expect(tiedPayload.data.nextCursor).toMatch(/^v1\./);

    const emptyCursor = new Date(tiedAt.getTime() + 1_000).toISOString();
    const empty = await loader(routeArgs(new UndiciRequest(
      `http://localhost/api/v1/shopping-list/sync?cursor=${encodeURIComponent(emptyCursor)}`,
      { headers: { Authorization: `Bearer ${fixture.credential.token}`, "X-Request-Id": "req_shopping_sync_empty_cursor" } },
    ) as unknown as Request, "shopping-list/sync"));
    const emptyPayload = await readJson(empty);

    expect(empty.status).toBe(200);
    expectSuccessEnvelope(emptyPayload, "req_shopping_sync_empty_cursor");
    expectExactKeys(emptyPayload.data, ["items", "nextCursor", "hasMore"]);
    expect(emptyPayload.data.items).toEqual([]);
    expect(emptyPayload.data.nextCursor).toBe(emptyCursor);

    const listUpdatedAt = new Date(tiedAt.getTime() + 120_000);
    await db.shoppingList.update({
      where: { id: fixture.list.id },
      data: { updatedAt: listUpdatedAt },
    });
    const list = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/shopping-list", {
      headers: { Authorization: `Bearer ${fixture.credential.token}`, "X-Request-Id": "req_shopping_list_newer_list" },
    }) as unknown as Request, "shopping-list"));
    const listPayload = await readJson(list);

    expect(list.status).toBe(200);
    expectSuccessEnvelope(listPayload, "req_shopping_list_newer_list");
    expect(listPayload.data.nextCursor).toBe(listPayload.data.shoppingList.updatedAt);
  });

  it("requires authentication, enforces shopping_list:read, and validates cursors", async () => {
    const fixture = await createShoppingFixture(db);

    const missingAuth = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/shopping-list", {
      headers: { "X-Request-Id": "req_shopping_missing_auth" },
    }) as unknown as Request, "shopping-list"));
    expect(missingAuth.status).toBe(401);
    expectEnvelopeHeaders(missingAuth, "req_shopping_missing_auth");
    await expect(readJson(missingAuth)).resolves.toMatchObject({
      ok: false,
      requestId: "req_shopping_missing_auth",
      error: { code: "authentication_required", status: 401 },
    });

    const missingScope = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/shopping-list", {
      headers: { Authorization: `Bearer ${fixture.writeOnlyCredential.token}`, "X-Request-Id": "req_shopping_missing_scope" },
    }) as unknown as Request, "shopping-list"));
    expect(missingScope.status).toBe(403);
    expectEnvelopeHeaders(missingScope, "req_shopping_missing_scope");
    await expect(readJson(missingScope)).resolves.toMatchObject({
      ok: false,
      requestId: "req_shopping_missing_scope",
      error: { code: "insufficient_scope", status: 403 },
    });

    const syncMissingScope = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/shopping-list/sync", {
      headers: { Authorization: `Bearer ${fixture.writeOnlyCredential.token}`, "X-Request-Id": "req_shopping_sync_missing_scope" },
    }) as unknown as Request, "shopping-list/sync"));
    expect(syncMissingScope.status).toBe(403);
    expectEnvelopeHeaders(syncMissingScope, "req_shopping_sync_missing_scope");
    await expect(readJson(syncMissingScope)).resolves.toMatchObject({
      ok: false,
      requestId: "req_shopping_sync_missing_scope",
      error: { code: "insufficient_scope", status: 403 },
    });

    const invalidCursors = [
      "not-a-date",
      "2026",
      "2026-06-01",
      "2026-06-01T00:00:00",
      "2026-06-01T00:00:00Z",
      "2026-02-30T00:00:00.000Z",
      "v1.%",
      syncCursor({}),
      syncCursor({ updatedAt: "not-a-date", id: "item_1" }),
      syncCursor({ updatedAt: "2026-06-01T00:00:00.000Z", id: 123 }),
    ];

    for (const [index, cursor] of invalidCursors.entries()) {
      const requestId = `req_shopping_invalid_cursor_${index}`;
      const invalidCursor = await loader(routeArgs(new UndiciRequest(
        `http://localhost/api/v1/shopping-list/sync?cursor=${encodeURIComponent(cursor)}`,
        { headers: { Authorization: `Bearer ${fixture.credential.token}`, "X-Request-Id": requestId } },
      ) as unknown as Request, "shopping-list/sync"));
      expect(invalidCursor.status).toBe(400);
      expectEnvelopeHeaders(invalidCursor, requestId);
      await expect(readJson(invalidCursor)).resolves.toMatchObject({
        ok: false,
        requestId,
        error: { code: "invalid_cursor", status: 400 },
      });
    }

    for (const [index, limit] of ["0", "51", "abc"].entries()) {
      const requestId = `req_shopping_invalid_limit_${index}`;
      const invalidLimit = await loader(routeArgs(new UndiciRequest(
        `http://localhost/api/v1/shopping-list/sync?limit=${limit}`,
        { headers: { Authorization: `Bearer ${fixture.credential.token}`, "X-Request-Id": requestId } },
      ) as unknown as Request, "shopping-list/sync"));
      expect(invalidLimit.status).toBe(400);
      expectEnvelopeHeaders(invalidLimit, requestId);
      await expect(readJson(invalidLimit)).resolves.toMatchObject({
        ok: false,
        requestId,
        error: { code: "validation_error", status: 400 },
      });
    }
  });

  it("adds recipe ingredients through API v1 with duplicate merge and idempotent replay", async () => {
    const fixture = await createShoppingFixture(db);
    const recipe = await createRecipeWithIngredients(db, fixture.user.id, [
      { name: "api duplicate sugar", quantity: 1, unit: "cup" },
      { name: "api duplicate sugar", quantity: 0.5, unit: "cup" },
    ]);

    const request = () => new UndiciRequest("http://localhost/api/v1/shopping-list/add-from-recipe", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fixture.writeOnlyCredential.token}`,
        "Content-Type": "application/json",
        "X-Request-Id": "req_shopping_add_recipe",
      },
      body: JSON.stringify({
        clientMutationId: "cm_api_add_recipe",
        recipeId: recipe.id,
        scaleFactor: 2,
      }),
    }) as unknown as Request;

    const response = await action(routeArgs(request(), "shopping-list/add-from-recipe"));
    const payload = await readJson(response);
    const replay = await action(routeArgs(request(), "shopping-list/add-from-recipe"));
    const replayPayload = await readJson(replay);

    expect(response.status).toBe(200);
    expectEnvelopeHeaders(response, "req_shopping_add_recipe");
    expectSuccessEnvelope(payload, "req_shopping_add_recipe");
    expectExactKeys(payload.data, ["recipe", "created", "updated", "items", "mutation"]);
    expect(payload.data).toMatchObject({
      created: 1,
      updated: 0,
      recipe: { id: recipe.id, title: recipe.title },
      items: [
        {
          name: "api duplicate sugar",
          quantity: 3,
          unit: "cup",
          checked: false,
          deletedAt: null,
        },
      ],
      mutation: { clientMutationId: "cm_api_add_recipe", replayed: false },
    });
    expectShoppingItemShape(payload.data.items[0]);
    expect(replay.status).toBe(200);
    expect(replayPayload.data.mutation.replayed).toBe(true);
    expect(replayPayload.data.items).toHaveLength(1);
    expect(await db.shoppingListItem.count({
      where: { shoppingListId: fixture.list.id, ingredientRef: { name: "api duplicate sugar" }, deletedAt: null },
    })).toBe(1);
  });

  it("returns missing recipes as not_found when adding ingredients from a recipe", async () => {
    const fixture = await createShoppingFixture(db);
    const request = () => new UndiciRequest("http://localhost/api/v1/shopping-list/add-from-recipe", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fixture.writeOnlyCredential.token}`,
        "Content-Type": "application/json",
        "X-Request-Id": "req_shopping_add_missing_recipe",
      },
      body: JSON.stringify({
        clientMutationId: "cm_api_add_missing_recipe",
        recipeId: "missing-recipe",
      }),
    }) as unknown as Request;

    const response = await action(routeArgs(request(), "shopping-list/add-from-recipe"));
    const retry = await action(routeArgs(request(), "shopping-list/add-from-recipe"));

    expect(response.status).toBe(404);
    expectEnvelopeHeaders(response, "req_shopping_add_missing_recipe");
    expectErrorEnvelope(await readJson(response), "req_shopping_add_missing_recipe", "not_found", 404);
    expect(retry.status).toBe(404);
    expectErrorEnvelope(await readJson(retry), "req_shopping_add_missing_recipe", "not_found", 404);
    expect(await db.apiIdempotencyKey.count({
      where: { userId: fixture.user.id, key: "cm_api_add_missing_recipe" },
    })).toBe(0);
  });

  it("updates existing shopping rows when adding ingredients from a recipe", async () => {
    const fixture = await createShoppingFixture(db);
    const pantryUnit = await getOrCreateUnit(db, `pantry unit ${faker.string.alphanumeric(6)}`);
    const pantryRef = await getOrCreateIngredientRef(db, `pantry item ${faker.string.numeric(12)}`);
    const pantryItem = await db.shoppingListItem.create({
      data: {
        shoppingListId: fixture.list.id,
        ingredientRefId: pantryRef.id,
        unitId: pantryUnit.id,
        quantity: 4,
        checked: false,
        sortIndex: 8,
        categoryKey: null,
        iconKey: null,
      },
    });
    const nullableUnit = await getOrCreateUnit(db, `nullable unit ${faker.string.alphanumeric(6)}`);
    const nullableRef = await getOrCreateIngredientRef(db, `nullable item ${faker.string.numeric(12)}`);
    const nullableQuantityItem = await db.shoppingListItem.create({
      data: {
        shoppingListId: fixture.list.id,
        ingredientRefId: nullableRef.id,
        unitId: nullableUnit.id,
        quantity: null,
        checked: false,
        sortIndex: 10,
        categoryKey: null,
        iconKey: null,
      },
    });
    await db.shoppingListItem.create({
      data: {
        shoppingListId: fixture.list.id,
        ingredientRefId: nullableRef.id,
        unitId: null,
        quantity: 99,
        checked: false,
        sortIndex: 11,
      },
    });
    const recipe = await createRecipeWithIngredients(db, fixture.user.id, [
      { name: fixture.activeRef.name, quantity: 2, unit: fixture.unit.name },
      { name: pantryRef.name, quantity: 3, unit: pantryUnit.name },
      { name: nullableRef.name, quantity: 5, unit: nullableUnit.name },
    ]);

    const response = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/shopping-list/add-from-recipe", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fixture.writeOnlyCredential.token}`,
        "Content-Type": "application/json",
        "X-Request-Id": "req_shopping_add_recipe_existing",
      },
      body: JSON.stringify({
        clientMutationId: "cm_api_add_recipe_existing",
        recipeId: recipe.id,
      }),
    }) as unknown as Request, "shopping-list/add-from-recipe"));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expectSuccessEnvelope(payload, "req_shopping_add_recipe_existing");
    expect(payload.data).toMatchObject({
      created: 0,
      updated: 3,
      mutation: { clientMutationId: "cm_api_add_recipe_existing", replayed: false },
    });
    expect(payload.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining(
        {
          id: fixture.active.id,
          quantity: 4,
          checked: false,
          checkedAt: null,
          deletedAt: null,
          categoryKey: "dairy",
          iconKey: "milk",
        },
      ),
      expect.objectContaining(
        {
          id: pantryItem.id,
          quantity: 7,
          checked: false,
          checkedAt: null,
          deletedAt: null,
          categoryKey: "other",
          iconKey: "package",
          sortIndex: 8,
        },
      ),
      expect.objectContaining(
        {
          id: nullableQuantityItem.id,
          quantity: 5,
          checked: false,
          checkedAt: null,
          deletedAt: null,
          categoryKey: "other",
          iconKey: "package",
          sortIndex: 10,
        },
      ),
    ]));
    const revivedActive = await db.shoppingListItem.findUniqueOrThrow({ where: { id: fixture.active.id } });
    const updatedPantry = await db.shoppingListItem.findUniqueOrThrow({ where: { id: pantryItem.id } });
    const updatedNullable = await db.shoppingListItem.findUniqueOrThrow({ where: { id: nullableQuantityItem.id } });
    expect(revivedActive.sortIndex).toBeGreaterThan(pantryItem.sortIndex);
    expect(updatedPantry.sortIndex).toBe(pantryItem.sortIndex);
    expect(updatedNullable.sortIndex).toBe(nullableQuantityItem.sortIndex);
  });

  it("returns an empty mutation result for recipes with no ingredients", async () => {
    const fixture = await createShoppingFixture(db);
    const recipe = await createRecipeWithIngredients(db, fixture.user.id, []);

    const response = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/shopping-list/add-from-recipe", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fixture.writeOnlyCredential.token}`,
        "Content-Type": "application/json",
        "X-Request-Id": "req_shopping_add_empty_recipe",
      },
      body: JSON.stringify({
        clientMutationId: "cm_api_add_empty_recipe",
        recipeId: recipe.id,
      }),
    }) as unknown as Request, "shopping-list/add-from-recipe"));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expectSuccessEnvelope(payload, "req_shopping_add_empty_recipe");
    expect(payload.data).toMatchObject({
      created: 0,
      updated: 0,
      items: [],
      mutation: { clientMutationId: "cm_api_add_empty_recipe", replayed: false },
    });
  });

  it("clears completed and all shopping-list items through API v1", async () => {
    const fixture = await createShoppingFixture(db);
    const uncheckedRef = await getOrCreateIngredientRef(db, `unchecked item ${faker.string.alphanumeric(6)}`);
    const unchecked = await db.shoppingListItem.create({
      data: {
        shoppingListId: fixture.list.id,
        ingredientRefId: uncheckedRef.id,
        quantity: 1,
        checked: false,
        sortIndex: 3,
      },
    });

    const clearCompleted = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/shopping-list/clear-completed", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fixture.writeOnlyCredential.token}`,
        "Content-Type": "application/json",
        "X-Request-Id": "req_shopping_clear_completed",
      },
      body: JSON.stringify({ clientMutationId: "cm_api_clear_completed" }),
    }) as unknown as Request, "shopping-list/clear-completed"));
    const clearCompletedPayload = await readJson(clearCompleted);

    expect(clearCompleted.status).toBe(200);
    expectEnvelopeHeaders(clearCompleted, "req_shopping_clear_completed");
    expectSuccessEnvelope(clearCompletedPayload, "req_shopping_clear_completed");
    expectExactKeys(clearCompletedPayload.data, ["removed", "items", "mutation"]);
    expect(clearCompletedPayload.data).toMatchObject({
      removed: 1,
      items: [{ id: fixture.active.id, deletedAt: expect.any(String) }],
      mutation: { clientMutationId: "cm_api_clear_completed", replayed: false },
    });
    expectShoppingItemShape(clearCompletedPayload.data.items[0]);
    expect(await db.shoppingListItem.findUnique({ where: { id: unchecked.id } })).toMatchObject({ deletedAt: null });

    const clearAll = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/shopping-list/clear-all", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fixture.writeOnlyCredential.token}`,
        "Content-Type": "application/json",
        "X-Request-Id": "req_shopping_clear_all",
      },
      body: JSON.stringify({ clientMutationId: "cm_api_clear_all" }),
    }) as unknown as Request, "shopping-list/clear-all"));
    const clearAllPayload = await readJson(clearAll);

    expect(clearAll.status).toBe(200);
    expectEnvelopeHeaders(clearAll, "req_shopping_clear_all");
    expectSuccessEnvelope(clearAllPayload, "req_shopping_clear_all");
    expect(clearAllPayload.data).toMatchObject({
      removed: 1,
      items: [{ id: unchecked.id, deletedAt: expect.any(String) }],
      mutation: { clientMutationId: "cm_api_clear_all", replayed: false },
    });
    expectShoppingItemShape(clearAllPayload.data.items[0]);
  });

  it("returns an empty mutation result when clearing a list with no completed items", async () => {
    const fixture = await createShoppingFixture(db);
    await db.shoppingListItem.update({
      where: { id: fixture.active.id },
      data: { checked: false, checkedAt: null },
    });

    const response = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/shopping-list/clear-completed", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fixture.writeOnlyCredential.token}`,
        "Content-Type": "application/json",
        "X-Request-Id": "req_shopping_clear_completed_empty",
      },
      body: JSON.stringify({ clientMutationId: "cm_api_clear_completed_empty" }),
    }) as unknown as Request, "shopping-list/clear-completed"));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expectSuccessEnvelope(payload, "req_shopping_clear_completed_empty");
    expect(payload.data).toEqual({
      removed: 0,
      items: [],
      mutation: { clientMutationId: "cm_api_clear_completed_empty", replayed: false },
    });
  });
});
