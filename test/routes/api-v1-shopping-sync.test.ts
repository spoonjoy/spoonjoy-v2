import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { resolveApiV1ScopeRequirement } from "~/lib/api-v1.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser, getOrCreateIngredientRef, getOrCreateUnit } from "../utils";

function routeArgs(request: Request, splat: string) {
  return { request, params: { "*": splat }, context: { cloudflare: { env: null } } } as any;
}

async function readJson(response: Response) {
  return await response.json() as any;
}

function expectEnvelopeHeaders(response: Response, requestId: string) {
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(response.headers.get("X-Request-Id")).toBe(requestId);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type, X-Request-Id");
  expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, PATCH, DELETE, OPTIONS");
  expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id");
}

function expectExactKeys(value: Record<string, unknown>, keys: string[]) {
  expect(Object.keys(value).sort()).toEqual([...keys].sort());
}

function expectSuccessEnvelope(payload: any, requestId: string) {
  expectExactKeys(payload, ["ok", "requestId", "data"]);
  expect(payload.ok).toBe(true);
  expect(payload.requestId).toBe(requestId);
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
    expect(allPayload.data.nextCursor).toBe(allPayload.data.items[1].updatedAt);

    const cursor = encodeURIComponent(allPayload.data.items[0].updatedAt);
    const filtered = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/shopping-list/sync?cursor=${cursor}`, {
      headers: { Authorization: `Bearer ${fixture.credential.token}`, "X-Request-Id": "req_shopping_sync_cursor" },
    }) as unknown as Request, "shopping-list/sync"));
    const filteredPayload = await readJson(filtered);

    expect(filtered.status).toBe(200);
    expectEnvelopeHeaders(filtered, "req_shopping_sync_cursor");
    expectSuccessEnvelope(filteredPayload, "req_shopping_sync_cursor");
    expectExactKeys(filteredPayload.data, ["items", "nextCursor", "hasMore"]);
    expect(filteredPayload.data.items.map((item: { id: string }) => item.id)).toEqual([fixture.tombstone.id]);
    expect(filteredPayload.data.hasMore).toBe(false);
    expect(filteredPayload.data.nextCursor).toBe(filteredPayload.data.items[0].updatedAt);
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

    const invalidCursor = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/shopping-list/sync?cursor=not-a-date", {
      headers: { Authorization: `Bearer ${fixture.credential.token}`, "X-Request-Id": "req_shopping_invalid_cursor" },
    }) as unknown as Request, "shopping-list/sync"));
    expect(invalidCursor.status).toBe(400);
    expectEnvelopeHeaders(invalidCursor, "req_shopping_invalid_cursor");
    await expect(readJson(invalidCursor)).resolves.toMatchObject({
      ok: false,
      requestId: "req_shopping_invalid_cursor",
      error: { code: "invalid_cursor", status: 400 },
    });
  });
});
