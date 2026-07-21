import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { action } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { resolveApiV1ScopeRequirement } from "~/lib/api-v1.server";
import { getLocalDb } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser, getOrCreateIngredientRef, getOrCreateUnit } from "../utils";

function routeArgs(request: Request, splat: string) {
  return { request, params: { "*": splat }, context: { cloudflare: { env: null } } } as any;
}

function mutationRequest(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  token: string,
  requestId: string,
  body: unknown,
) {
  return new UndiciRequest(`http://localhost/api/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Request-Id": requestId,
    },
    body: JSON.stringify(body),
  }) as unknown as Request;
}

async function readJson(response: Response) {
  return await response.json() as any;
}

async function sessionCookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

function expectExactKeys(value: Record<string, unknown>, keys: string[]) {
  expect(Object.keys(value).sort()).toEqual([...keys].sort());
}

function expectEnvelopeHeaders(response: Response, requestId: string) {
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(response.headers.get("X-Request-Id")).toBe(requestId);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type, X-Request-Id, X-Client-Mutation-Id");
  expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, PATCH, PUT, DELETE, OPTIONS");
  expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id, Retry-After");
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

function expectMutationShape(mutation: any, clientMutationId: string, replayed: boolean) {
  expectExactKeys(mutation, ["clientMutationId", "replayed"]);
  expect(mutation).toEqual({ clientMutationId, replayed });
}

async function createShoppingMutationFixture(db: Awaited<ReturnType<typeof getLocalDb>>) {
  const user = await db.user.create({ data: createTestUser() });
  const credential = await createApiCredential(db, user.id, "Shopping writer", { scopes: ["shopping_list:write"] });
  const legacyCredential = await createApiCredential(db, user.id, "Legacy shopping writer", { scopes: ["kitchen:write"] });
  const readOnlyCredential = await createApiCredential(db, user.id, "Shopping reader", { scopes: ["shopping_list:read"] });
  const list = await db.shoppingList.create({ data: { authorId: user.id } });
  return { user, credential, legacyCredential, readOnlyCredential, list };
}

async function createExistingItem(db: Awaited<ReturnType<typeof getLocalDb>>, userId: string, name: string) {
  const list = await db.shoppingList.findUniqueOrThrow({ where: { authorId: userId } });
  const ingredientRef = await getOrCreateIngredientRef(db, name);
  return await db.shoppingListItem.create({
    data: {
      shoppingListId: list.id,
      ingredientRefId: ingredientRef.id,
      quantity: 1,
      sortIndex: 0,
    },
  });
}

const LEGACY_SHOPPING_IDENTITY_INDEX = "ShoppingListItem_shoppingListId_unitId_ingredientRefId_key";
const ACTIVE_SHOPPING_IDENTITY_INDEX = "ShoppingListItem_active_identity_key";

async function withPost0025ShoppingIdentityIndex<T>(
  db: Awaited<ReturnType<typeof getLocalDb>>,
  run: () => Promise<T>,
): Promise<T> {
  try {
    await db.$executeRawUnsafe(`DROP INDEX IF EXISTS "${ACTIVE_SHOPPING_IDENTITY_INDEX}"`);
    await db.$executeRawUnsafe(`DROP INDEX IF EXISTS "${LEGACY_SHOPPING_IDENTITY_INDEX}"`);
    await db.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "${ACTIVE_SHOPPING_IDENTITY_INDEX}"
      ON "ShoppingListItem" ("shoppingListId", "ingredientRefId", COALESCE('u:' || "unitId", 'n:'))
      WHERE "deletedAt" IS NULL
    `);
    return await run();
  } finally {
    await db.shoppingListItem.deleteMany({});
    await db.$executeRawUnsafe(`DROP INDEX IF EXISTS "${ACTIVE_SHOPPING_IDENTITY_INDEX}"`);
    await db.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "${LEGACY_SHOPPING_IDENTITY_INDEX}"
      ON "ShoppingListItem" ("shoppingListId", "unitId", "ingredientRefId")
    `);
  }
}

describe("API v1 shopping-list mutations", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  it("declares write scope rows for item mutation endpoints", () => {
    expect(resolveApiV1ScopeRequirement("POST", "shopping-list/items")).toEqual({
      auth: "bearer",
      scopes: ["shopping_list:write"],
    });
    expect(resolveApiV1ScopeRequirement("PATCH", "shopping-list/items/item_1")).toEqual({
      auth: "bearer",
      scopes: ["shopping_list:write"],
    });
    expect(resolveApiV1ScopeRequirement("DELETE", "shopping-list/items/item_1")).toEqual({
      auth: "bearer",
      scopes: ["shopping_list:write"],
    });
  });

  it("adds, checks, and removes shopping-list items with exact mutation envelopes", async () => {
    const fixture = await createShoppingMutationFixture(db);

    const addBody = {
      clientMutationId: "client-add-1",
      name: `Eggs ${faker.string.alphanumeric(6)}`,
      quantity: 12,
      unit: "Each",
      categoryKey: "dairy",
      iconKey: "egg",
    };
    const add = await action(routeArgs(
      mutationRequest("POST", "shopping-list/items", fixture.credential.token, "req_add_item", addBody),
      "shopping-list/items",
    ));
    const addPayload = await readJson(add);

    expect(add.status).toBe(201);
    expectEnvelopeHeaders(add, "req_add_item");
    expectSuccessEnvelope(addPayload, "req_add_item");
    expectExactKeys(addPayload.data, ["created", "updated", "item", "mutation"]);
    expect(addPayload.data).toMatchObject({ created: true, updated: false });
    expectShoppingItemShape(addPayload.data.item);
    expect(addPayload.data.item).toMatchObject({
      name: addBody.name.toLowerCase(),
      quantity: 12,
      unit: "each",
      checked: false,
      checkedAt: null,
      deletedAt: null,
      categoryKey: "dairy",
      iconKey: "egg",
      sortIndex: 0,
    });
    expectMutationShape(addPayload.data.mutation, "client-add-1", false);

    const check = await action(routeArgs(
      mutationRequest("PATCH", `shopping-list/items/${addPayload.data.item.id}`, fixture.credential.token, "req_check_item", {
        clientMutationId: "client-check-1",
        checked: true,
      }),
      `shopping-list/items/${addPayload.data.item.id}`,
    ));
    const checkPayload = await readJson(check);

    expect(check.status).toBe(200);
    expectEnvelopeHeaders(check, "req_check_item");
    expectSuccessEnvelope(checkPayload, "req_check_item");
    expectExactKeys(checkPayload.data, ["item", "mutation"]);
    expectShoppingItemShape(checkPayload.data.item);
    expect(checkPayload.data.item).toMatchObject({
      id: addPayload.data.item.id,
      checked: true,
      checkedAt: expect.any(String),
      deletedAt: null,
    });
    expectMutationShape(checkPayload.data.mutation, "client-check-1", false);

    const remove = await action(routeArgs(
      mutationRequest("DELETE", `shopping-list/items/${addPayload.data.item.id}`, fixture.credential.token, "req_remove_item", {
        clientMutationId: "client-remove-1",
      }),
      `shopping-list/items/${addPayload.data.item.id}`,
    ));
    const removePayload = await readJson(remove);

    expect(remove.status).toBe(200);
    expectEnvelopeHeaders(remove, "req_remove_item");
    expectSuccessEnvelope(removePayload, "req_remove_item");
    expectExactKeys(removePayload.data, ["removed", "item", "mutation"]);
    expect(removePayload.data.removed).toBe(true);
    expectShoppingItemShape(removePayload.data.item);
    expect(removePayload.data.item).toMatchObject({
      id: addPayload.data.item.id,
      checked: true,
      deletedAt: expect.any(String),
    });
    expectMutationShape(removePayload.data.mutation, "client-remove-1", false);

    const legacyAdd = await action(routeArgs(
      mutationRequest("POST", "shopping-list/items", fixture.legacyCredential.token, "req_add_item_legacy", {
        clientMutationId: "client-add-legacy",
        name: `Milk ${faker.string.alphanumeric(6)}`,
      }),
      "shopping-list/items",
    ));
    expect(legacyAdd.status).toBe(201);

    const cookie = await sessionCookie(fixture.user.id);
    const sessionAdd = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/shopping-list/items", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", "X-Request-Id": "req_add_item_session" },
      body: JSON.stringify({
        clientMutationId: "client-add-session",
        name: `Bread ${faker.string.alphanumeric(6)}`,
        categoryKey: null,
        iconKey: null,
      }),
    }) as unknown as Request, "shopping-list/items"));
    expect(sessionAdd.status).toBe(201);
  });

  it("accepts DELETE clientMutationId from the JSON body, query string, or header", async () => {
    const fixture = await createShoppingMutationFixture(db);
    const bodyItem = await createExistingItem(db, fixture.user.id, `Body delete eggs ${faker.string.alphanumeric(6)}`);
    const queryItem = await createExistingItem(db, fixture.user.id, `Query delete milk ${faker.string.alphanumeric(6)}`);
    const headerItem = await createExistingItem(db, fixture.user.id, `Header delete bread ${faker.string.alphanumeric(6)}`);

    const bodyDelete = await action(routeArgs(
      mutationRequest("DELETE", `shopping-list/items/${bodyItem.id}`, fixture.credential.token, "req_delete_body_id", {
        clientMutationId: "delete-body-id",
      }),
      `shopping-list/items/${bodyItem.id}`,
    ));
    const bodyDeletePayload = await readJson(bodyDelete);

    expect(bodyDelete.status).toBe(200);
    expectEnvelopeHeaders(bodyDelete, "req_delete_body_id");
    expectSuccessEnvelope(bodyDeletePayload, "req_delete_body_id");
    expect(bodyDeletePayload.data).toMatchObject({
      removed: true,
      item: { id: bodyItem.id, deletedAt: expect.any(String) },
    });
    expectMutationShape(bodyDeletePayload.data.mutation, "delete-body-id", false);

    const queryDelete = await action(routeArgs(new UndiciRequest(
      `http://localhost/api/v1/shopping-list/items/${queryItem.id}?clientMutationId=delete-query-id`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${fixture.credential.token}`,
          "X-Request-Id": "req_delete_query_id",
        },
      },
    ) as unknown as Request, `shopping-list/items/${queryItem.id}`));
    const queryDeletePayload = await readJson(queryDelete);

    expect(queryDelete.status).toBe(200);
    expectEnvelopeHeaders(queryDelete, "req_delete_query_id");
    expectSuccessEnvelope(queryDeletePayload, "req_delete_query_id");
    expect(queryDeletePayload.data).toMatchObject({
      removed: true,
      item: { id: queryItem.id, deletedAt: expect.any(String) },
    });
    expectMutationShape(queryDeletePayload.data.mutation, "delete-query-id", false);

    const headerDelete = await action(routeArgs(new UndiciRequest(
      `http://localhost/api/v1/shopping-list/items/${headerItem.id}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${fixture.credential.token}`,
          "X-Request-Id": "req_delete_header_id",
          "X-Client-Mutation-Id": "delete-header-id",
        },
      },
    ) as unknown as Request, `shopping-list/items/${headerItem.id}`));
    const headerDeletePayload = await readJson(headerDelete);

    expect(headerDelete.status).toBe(200);
    expectEnvelopeHeaders(headerDelete, "req_delete_header_id");
    expectSuccessEnvelope(headerDeletePayload, "req_delete_header_id");
    expect(headerDeletePayload.data).toMatchObject({
      removed: true,
      item: { id: headerItem.id, deletedAt: expect.any(String) },
    });
    expectMutationShape(headerDeletePayload.data.mutation, "delete-header-id", false);
  });

  it("restores matching items, rejects unknown fields, and requires clientMutationId", async () => {
    const fixture = await createShoppingMutationFixture(db);
    const unit = await getOrCreateUnit(db, `box ${faker.string.alphanumeric(6)}`.toLowerCase());
    const ingredientRef = await getOrCreateIngredientRef(db, `restored ${faker.string.alphanumeric(6)}`.toLowerCase());
    const existing = await db.shoppingListItem.create({
      data: {
        shoppingListId: fixture.list.id,
        ingredientRefId: ingredientRef.id,
        unitId: unit.id,
        quantity: 2,
        checked: true,
        checkedAt: new Date(),
        deletedAt: new Date(),
        sortIndex: 4,
        categoryKey: "old-category",
        iconKey: "old-icon",
      },
    });

    const restore = await action(routeArgs(
      mutationRequest("POST", "shopping-list/items", fixture.credential.token, "req_restore_item", {
        clientMutationId: "client-restore-1",
        name: ingredientRef.name,
        quantity: 3,
        unit: unit.name,
        categoryKey: "new-category",
        iconKey: "new-icon",
      }),
      "shopping-list/items",
    ));
    const restorePayload = await readJson(restore);

    expect(restore.status).toBe(200);
    expectEnvelopeHeaders(restore, "req_restore_item");
    expectSuccessEnvelope(restorePayload, "req_restore_item");
    expectExactKeys(restorePayload.data, ["created", "updated", "item", "mutation"]);
    expect(restorePayload.data).toMatchObject({ created: false, updated: true });
    expectShoppingItemShape(restorePayload.data.item);
    expect(restorePayload.data.item).toMatchObject({
      id: existing.id,
      name: ingredientRef.name,
      quantity: 5,
      unit: unit.name,
      checked: false,
      checkedAt: null,
      deletedAt: null,
      categoryKey: "new-category",
      iconKey: "new-icon",
    });
    expectMutationShape(restorePayload.data.mutation, "client-restore-1", false);

    const cases = [
      {
        method: "POST" as const,
        path: "shopping-list/items",
        requestId: "req_add_unknown_field",
        body: { clientMutationId: "bad-add-extra", name: "Tea", extra: true },
      },
      {
        method: "PATCH" as const,
        path: `shopping-list/items/${existing.id}`,
        requestId: "req_check_unknown_field",
        body: { clientMutationId: "bad-check-extra", checked: false, extra: true },
      },
      {
        method: "DELETE" as const,
        path: `shopping-list/items/${existing.id}`,
        requestId: "req_remove_unknown_field",
        body: { clientMutationId: "bad-remove-extra", extra: true },
      },
      {
        method: "POST" as const,
        path: "shopping-list/items",
        requestId: "req_add_missing_client_mutation",
        body: { name: "Tea" },
      },
      {
        method: "PATCH" as const,
        path: `shopping-list/items/${existing.id}`,
        requestId: "req_check_blank_client_mutation",
        body: { clientMutationId: " ", checked: false },
      },
      {
        method: "DELETE" as const,
        path: `shopping-list/items/${existing.id}`,
        requestId: "req_remove_missing_client_mutation",
        body: {},
      },
    ];

    for (const testCase of cases) {
      const response = await action(routeArgs(
        mutationRequest(testCase.method, testCase.path, fixture.credential.token, testCase.requestId, testCase.body),
        testCase.path,
      ));
      expect(response.status).toBe(400);
      expectEnvelopeHeaders(response, testCase.requestId);
      expectErrorEnvelope(await readJson(response), testCase.requestId, "validation_error", 400);
    }
  });

  it("uses the active null-unit identity and leaves its tombstone under the post-0025 index", async () => {
    const fixture = await createShoppingMutationFixture(db);
    const ingredientRef = await getOrCreateIngredientRef(db, `active first ${faker.string.alphanumeric(6)}`.toLowerCase());
    await withPost0025ShoppingIdentityIndex(db, async () => {
      const tombstone = await db.shoppingListItem.create({
        data: {
          id: "compat-rest-manual-identity-A",
          shoppingListId: fixture.list.id,
          ingredientRefId: ingredientRef.id,
          unitId: null,
          quantity: 100,
          checked: true,
          checkedAt: new Date(),
          deletedAt: new Date(),
          sortIndex: -10,
        },
      });
      const active = await db.shoppingListItem.create({
        data: {
          id: "compat-rest-manual-identity-a",
          shoppingListId: fixture.list.id,
          ingredientRefId: ingredientRef.id,
          unitId: null,
          quantity: 2,
          sortIndex: 1,
          categoryKey: "existing-category",
          iconKey: "existing-icon",
        },
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const response = await action(routeArgs(
        mutationRequest("POST", "shopping-list/items", fixture.credential.token, "req_compat_active_first", {
          clientMutationId: "compat-active-first",
          name: ingredientRef.name,
          quantity: 3,
          categoryKey: "incoming-category",
        }),
        "shopping-list/items",
      ));
      const payload = await readJson(response);

      expect(response.status).toBe(200);
      expectEnvelopeHeaders(response, "req_compat_active_first");
      expectSuccessEnvelope(payload, "req_compat_active_first");
      expectExactKeys(payload.data, ["created", "updated", "item", "mutation"]);
      expect(payload.data).toMatchObject({
        created: false,
        updated: true,
        item: {
          id: active.id,
          quantity: 5,
          checked: false,
          checkedAt: null,
          deletedAt: null,
          sortIndex: 1,
          categoryKey: "incoming-category",
          iconKey: "existing-icon",
        },
      });
      expectShoppingItemShape(payload.data.item);
      expectMutationShape(payload.data.mutation, "compat-active-first", false);
      await expect(db.shoppingListItem.findUniqueOrThrow({ where: { id: tombstone.id } })).resolves.toMatchObject({
        quantity: 100,
        checked: true,
        deletedAt: expect.any(Date),
      });
    });
  });

  it("restores the earliest sortIndex then BINARY id tombstone under the post-0025 index", async () => {
    const fixture = await createShoppingMutationFixture(db);
    const ingredientRef = await getOrCreateIngredientRef(db, `tombstone first ${faker.string.alphanumeric(6)}`.toLowerCase());
    await withPost0025ShoppingIdentityIndex(db, async () => {
      const tiedBinaryLater = await db.shoppingListItem.create({
        data: {
          id: "compat-rest-manual-tombstone-a",
          shoppingListId: fixture.list.id,
          ingredientRefId: ingredientRef.id,
          unitId: null,
          quantity: 20,
          checked: true,
          checkedAt: new Date(),
          deletedAt: new Date(),
          sortIndex: 2,
        },
      });
      const laterSortIndex = await db.shoppingListItem.create({
        data: {
          id: "compat-rest-manual-tombstone-0",
          shoppingListId: fixture.list.id,
          ingredientRefId: ingredientRef.id,
          unitId: null,
          quantity: 200,
          checked: true,
          checkedAt: new Date(),
          deletedAt: new Date(),
          sortIndex: 3,
        },
      });
      const expectedTombstone = await db.shoppingListItem.create({
        data: {
          id: "compat-rest-manual-tombstone-A",
          shoppingListId: fixture.list.id,
          ingredientRefId: ingredientRef.id,
          unitId: null,
          quantity: 2,
          checked: true,
          checkedAt: new Date(),
          deletedAt: new Date(),
          sortIndex: 2,
          categoryKey: "existing-category",
        },
      });

      const response = await action(routeArgs(
        mutationRequest("POST", "shopping-list/items", fixture.credential.token, "req_compat_tombstone_first", {
          clientMutationId: "compat-tombstone-first",
          name: ingredientRef.name,
          quantity: 3,
          iconKey: "incoming-icon",
        }),
        "shopping-list/items",
      ));
      const payload = await readJson(response);

      expect(response.status).toBe(200);
      expectEnvelopeHeaders(response, "req_compat_tombstone_first");
      expectSuccessEnvelope(payload, "req_compat_tombstone_first");
      expectExactKeys(payload.data, ["created", "updated", "item", "mutation"]);
      expect(payload.data).toMatchObject({
        created: false,
        updated: true,
        item: {
          id: expectedTombstone.id,
          quantity: 5,
          checked: false,
          checkedAt: null,
          deletedAt: null,
          sortIndex: 0,
          categoryKey: "existing-category",
          iconKey: "incoming-icon",
        },
      });
      expectShoppingItemShape(payload.data.item);
      expectMutationShape(payload.data.mutation, "compat-tombstone-first", false);
      await expect(db.shoppingListItem.findUniqueOrThrow({ where: { id: tiedBinaryLater.id } })).resolves.toMatchObject({
        quantity: 20,
        checked: true,
        deletedAt: expect.any(Date),
      });
      await expect(db.shoppingListItem.findUniqueOrThrow({ where: { id: laterSortIndex.id } })).resolves.toMatchObject({
        quantity: 200,
        checked: true,
        deletedAt: expect.any(Date),
      });
    });
  });

  it("rereads and updates the active identity once after a create uniqueness conflict", async () => {
    const fixture = await createShoppingMutationFixture(db);
    const ingredientRef = await getOrCreateIngredientRef(db, `conflict reread ${faker.string.alphanumeric(6)}`.toLowerCase());
    const delegate = db.shoppingListItem as any;
    const originalCreate = delegate.create.bind(delegate);
    const createSpy = vi.spyOn(delegate, "create").mockImplementationOnce(async () => {
      await originalCreate({
        data: {
          id: "compat-rest-manual-conflict-winner",
          shoppingListId: fixture.list.id,
          ingredientRefId: ingredientRef.id,
          unitId: null,
          quantity: 2,
          sortIndex: 0,
          categoryKey: "winner-category",
        },
      });
      throw Object.assign(new Error("Unique constraint failed on the fields"), {
        code: "P2002",
        meta: { modelName: "ShoppingListItem" },
      });
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const request = (requestId: string) => mutationRequest(
      "POST",
      "shopping-list/items",
      fixture.credential.token,
      requestId,
      {
        clientMutationId: "compat-conflict-reread",
        name: ingredientRef.name,
        quantity: 3,
        iconKey: "incoming-icon",
      },
    );
    const response = await action(routeArgs(request("req_compat_conflict_reread"), "shopping-list/items"));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expectEnvelopeHeaders(response, "req_compat_conflict_reread");
    expectSuccessEnvelope(payload, "req_compat_conflict_reread");
    expectExactKeys(payload.data, ["created", "updated", "item", "mutation"]);
    expect(payload.data).toMatchObject({
      created: false,
      updated: true,
      item: {
        id: "compat-rest-manual-conflict-winner",
        quantity: 5,
        categoryKey: "winner-category",
        iconKey: "incoming-icon",
      },
      mutation: { clientMutationId: "compat-conflict-reread", replayed: false },
    });
    expectShoppingItemShape(payload.data.item);
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(await db.shoppingListItem.count({
      where: { shoppingListId: fixture.list.id, ingredientRefId: ingredientRef.id, unitId: null },
    })).toBe(1);

    const replay = await action(routeArgs(request("req_compat_conflict_replay"), "shopping-list/items"));
    const replayPayload = await readJson(replay);
    expect(replay.status).toBe(200);
    expectEnvelopeHeaders(replay, "req_compat_conflict_replay");
    expect(replayPayload).toEqual({
      ...payload,
      requestId: "req_compat_conflict_replay",
      data: {
        ...payload.data,
        mutation: { clientMutationId: "compat-conflict-reread", replayed: true },
      },
    });
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it("covers mutation validation, duplicate text, false checks, and missing item boundaries", async () => {
    const fixture = await createShoppingMutationFixture(db);
    const duplicateName = `Duplicate Pears ${faker.string.alphanumeric(6)}`;
    const firstAdd = await action(routeArgs(
      mutationRequest("POST", "shopping-list/items", fixture.credential.token, "req_duplicate_first", {
        clientMutationId: "duplicate-first",
        name: duplicateName,
        quantity: 4,
      }),
      "shopping-list/items",
    ));
    const firstPayload = await readJson(firstAdd);

    expect(firstAdd.status).toBe(201);
    expectSuccessEnvelope(firstPayload, "req_duplicate_first");

    const duplicateAdd = await action(routeArgs(
      mutationRequest("POST", "shopping-list/items", fixture.credential.token, "req_duplicate_second", {
        clientMutationId: "duplicate-second",
        name: duplicateName,
      }),
      "shopping-list/items",
    ));
    const duplicatePayload = await readJson(duplicateAdd);

    expect(duplicateAdd.status).toBe(200);
    expectSuccessEnvelope(duplicatePayload, "req_duplicate_second");
    expect(duplicatePayload.data).toMatchObject({
      created: false,
      updated: true,
      item: { id: firstPayload.data.item.id, quantity: 4, checked: false, deletedAt: null },
      mutation: { clientMutationId: "duplicate-second", replayed: false },
    });

    const nullQuantityName = `Null Quantity Plums ${faker.string.alphanumeric(6)}`;
    const nullQuantityFirst = await action(routeArgs(
      mutationRequest("POST", "shopping-list/items", fixture.credential.token, "req_null_quantity_first", {
        clientMutationId: "null-quantity-first",
        name: nullQuantityName,
        categoryKey: " ",
        iconKey: " ",
      }),
      "shopping-list/items",
    ));
    expect(nullQuantityFirst.status).toBe(201);

    const nullQuantitySecond = await action(routeArgs(
      mutationRequest("POST", "shopping-list/items", fixture.credential.token, "req_null_quantity_second", {
        clientMutationId: "null-quantity-second",
        name: nullQuantityName,
      }),
      "shopping-list/items",
    ));
    const nullQuantityPayload = await readJson(nullQuantitySecond);

    expect(nullQuantitySecond.status).toBe(200);
    expectSuccessEnvelope(nullQuantityPayload, "req_null_quantity_second");
    expect(nullQuantityPayload.data.item).toMatchObject({ quantity: null });

    const nullQuantityThird = await action(routeArgs(
      mutationRequest("POST", "shopping-list/items", fixture.credential.token, "req_null_quantity_third", {
        clientMutationId: "null-quantity-third",
        name: nullQuantityName,
        quantity: 2,
      }),
      "shopping-list/items",
    ));
    const nullQuantityThirdPayload = await readJson(nullQuantityThird);

    expect(nullQuantityThird.status).toBe(200);
    expectSuccessEnvelope(nullQuantityThirdPayload, "req_null_quantity_third");
    expect(nullQuantityThirdPayload.data.item).toMatchObject({ quantity: 2 });

    const uncheck = await action(routeArgs(
      mutationRequest("PATCH", `shopping-list/items/${firstPayload.data.item.id}`, fixture.credential.token, "req_check_false", {
        clientMutationId: "check-false",
        checked: false,
      }),
      `shopping-list/items/${firstPayload.data.item.id}`,
    ));
    const uncheckPayload = await readJson(uncheck);

    expect(uncheck.status).toBe(200);
    expectSuccessEnvelope(uncheckPayload, "req_check_false");
    expect(uncheckPayload.data.item).toMatchObject({ id: firstPayload.data.item.id, checked: false, checkedAt: null });

    const deleteOnce = await action(routeArgs(
      mutationRequest("DELETE", `shopping-list/items/${firstPayload.data.item.id}`, fixture.credential.token, "req_delete_once", {
        clientMutationId: "delete-once",
      }),
      `shopping-list/items/${firstPayload.data.item.id}`,
    ));
    expect(deleteOnce.status).toBe(200);

    const deleteAgain = await action(routeArgs(
      mutationRequest("DELETE", `shopping-list/items/${firstPayload.data.item.id}`, fixture.credential.token, "req_delete_twice", {
        clientMutationId: "delete-twice",
      }),
      `shopping-list/items/${firstPayload.data.item.id}`,
    ));
    const deleteAgainPayload = await readJson(deleteAgain);

    expect(deleteAgain.status).toBe(200);
    expectSuccessEnvelope(deleteAgainPayload, "req_delete_twice");
    expect(deleteAgainPayload.data).toMatchObject({
      removed: true,
      item: { id: firstPayload.data.item.id, deletedAt: expect.any(String) },
      mutation: { clientMutationId: "delete-twice", replayed: false },
    });

    const validationCases = [
      {
        method: "POST" as const,
        path: "shopping-list/items",
        requestId: "req_add_blank_name",
        body: { clientMutationId: "blank-name", name: " " },
      },
      {
        method: "POST" as const,
        path: "shopping-list/items",
        requestId: "req_add_bad_quantity",
        body: { clientMutationId: "bad-quantity", name: "Tea", quantity: 0 },
      },
      {
        method: "POST" as const,
        path: "shopping-list/items",
        requestId: "req_add_bad_unit",
        body: { clientMutationId: "bad-unit", name: "Tea", unit: 5 },
      },
      {
        method: "POST" as const,
        path: "shopping-list/items",
        requestId: "req_add_long_category",
        body: { clientMutationId: "bad-category", name: "Tea", categoryKey: "x".repeat(161) },
      },
      {
        method: "PATCH" as const,
        path: `shopping-list/items/${firstPayload.data.item.id}`,
        requestId: "req_check_bad_boolean",
        body: { clientMutationId: "bad-boolean", checked: "yes" },
      },
    ];

    for (const testCase of validationCases) {
      const response = await action(routeArgs(
        mutationRequest(testCase.method, testCase.path, fixture.credential.token, testCase.requestId, testCase.body),
        testCase.path,
      ));
      expect(response.status).toBe(400);
      expectEnvelopeHeaders(response, testCase.requestId);
      expectErrorEnvelope(await readJson(response), testCase.requestId, "validation_error", 400);
    }

    const missingPatch = await action(routeArgs(
      mutationRequest("PATCH", "shopping-list/items/missing-item", fixture.credential.token, "req_check_missing_item", {
        clientMutationId: "missing-check",
        checked: true,
      }),
      "shopping-list/items/missing-item",
    ));
    expect(missingPatch.status).toBe(404);
    expectEnvelopeHeaders(missingPatch, "req_check_missing_item");
    expectErrorEnvelope(await readJson(missingPatch), "req_check_missing_item", "not_found", 404);

    const missingDelete = await action(routeArgs(
      mutationRequest("DELETE", "shopping-list/items/missing-item", fixture.credential.token, "req_delete_missing_item", {
        clientMutationId: "missing-delete",
      }),
      "shopping-list/items/missing-item",
    ));
    expect(missingDelete.status).toBe(404);
    expectEnvelopeHeaders(missingDelete, "req_delete_missing_item");
    expectErrorEnvelope(await readJson(missingDelete), "req_delete_missing_item", "not_found", 404);
  });

  it("replays exact idempotent responses and rejects key conflicts", async () => {
    const fixture = await createShoppingMutationFixture(db);
    const addBody = {
      clientMutationId: "idem-add",
      name: `Replay Apples ${faker.string.alphanumeric(6)}`,
      quantity: 2,
    };
    const first = await action(routeArgs(
      mutationRequest("POST", "shopping-list/items", fixture.credential.token, "req_idem_add_first", addBody),
      "shopping-list/items",
    ));
    const firstPayload = await readJson(first);

    expect(first.status).toBe(201);
    expectSuccessEnvelope(firstPayload, "req_idem_add_first");
    expectMutationShape(firstPayload.data.mutation, "idem-add", false);

    const replay = await action(routeArgs(
      mutationRequest("POST", "shopping-list/items", fixture.credential.token, "req_idem_add_replay", addBody),
      "shopping-list/items",
    ));
    const replayPayload = await readJson(replay);
    const expectedReplay = structuredClone(firstPayload);
    expectedReplay.requestId = "req_idem_add_replay";
    expectedReplay.data.mutation.replayed = true;

    expect(replay.status).toBe(201);
    expectEnvelopeHeaders(replay, "req_idem_add_replay");
    expect(replayPayload).toEqual(expectedReplay);

    const differentBody = await action(routeArgs(
      mutationRequest("POST", "shopping-list/items", fixture.credential.token, "req_idem_add_body_conflict", {
        ...addBody,
        quantity: 3,
      }),
      "shopping-list/items",
    ));
    expect(differentBody.status).toBe(409);
    expectEnvelopeHeaders(differentBody, "req_idem_add_body_conflict");
    expectErrorEnvelope(await readJson(differentBody), "req_idem_add_body_conflict", "idempotency_conflict", 409);

    const differentOperation = await action(routeArgs(
      mutationRequest("PATCH", `shopping-list/items/${firstPayload.data.item.id}`, fixture.credential.token, "req_idem_operation_conflict", {
        clientMutationId: "idem-add",
        checked: true,
      }),
      `shopping-list/items/${firstPayload.data.item.id}`,
    ));
    expect(differentOperation.status).toBe(409);
    expectEnvelopeHeaders(differentOperation, "req_idem_operation_conflict");
    expectErrorEnvelope(await readJson(differentOperation), "req_idem_operation_conflict", "idempotency_conflict", 409);

    const secondItem = await createExistingItem(db, fixture.user.id, `Replay Bananas ${faker.string.alphanumeric(6)}`);
    const checkBody = { clientMutationId: "idem-check-path", checked: true };
    const checkFirst = await action(routeArgs(
      mutationRequest("PATCH", `shopping-list/items/${firstPayload.data.item.id}`, fixture.credential.token, "req_idem_check_first", checkBody),
      `shopping-list/items/${firstPayload.data.item.id}`,
    ));
    expect(checkFirst.status).toBe(200);

    const differentPath = await action(routeArgs(
      mutationRequest("PATCH", `shopping-list/items/${secondItem.id}`, fixture.credential.token, "req_idem_path_conflict", checkBody),
      `shopping-list/items/${secondItem.id}`,
    ));
    expect(differentPath.status).toBe(409);
    expectEnvelopeHeaders(differentPath, "req_idem_path_conflict");
    expectErrorEnvelope(await readJson(differentPath), "req_idem_path_conflict", "idempotency_conflict", 409);

    await db.apiIdempotencyKey.updateMany({
      where: { key: "idem-add" },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const reuseAfterExpiry = await action(routeArgs(
      mutationRequest("POST", "shopping-list/items", fixture.credential.token, "req_idem_expired_reuse", {
        clientMutationId: "idem-add",
        name: `Expired Key Grapes ${faker.string.alphanumeric(6)}`,
      }),
      "shopping-list/items",
    ));
    const reuseAfterExpiryPayload = await readJson(reuseAfterExpiry);

    expect(reuseAfterExpiry.status).toBe(201);
    expectSuccessEnvelope(reuseAfterExpiryPayload, "req_idem_expired_reuse");
    expect(reuseAfterExpiryPayload.data.mutation).toEqual({ clientMutationId: "idem-add", replayed: false });
  });

  it("enforces shopping_list:write before mutation body handling", async () => {
    const fixture = await createShoppingMutationFixture(db);
    const item = await createExistingItem(db, fixture.user.id, `Scoped Oranges ${faker.string.alphanumeric(6)}`);

    const missingAuth = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/shopping-list/items", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": "req_mutation_missing_auth" },
      body: JSON.stringify({ clientMutationId: "no-auth", name: "No Auth" }),
    }) as unknown as Request, "shopping-list/items"));
    expect(missingAuth.status).toBe(401);
    expectEnvelopeHeaders(missingAuth, "req_mutation_missing_auth");
    expectErrorEnvelope(await readJson(missingAuth), "req_mutation_missing_auth", "authentication_required", 401);

    const insufficient = [
      {
        method: "POST" as const,
        path: "shopping-list/items",
        requestId: "req_add_missing_write_scope",
        body: { clientMutationId: "scope-add", name: "Tea", unexpected: true },
      },
      {
        method: "PATCH" as const,
        path: `shopping-list/items/${item.id}`,
        requestId: "req_check_missing_write_scope",
        body: { clientMutationId: "scope-check", checked: true, unexpected: true },
      },
      {
        method: "DELETE" as const,
        path: `shopping-list/items/${item.id}`,
        requestId: "req_remove_missing_write_scope",
        body: { clientMutationId: "scope-remove", unexpected: true },
      },
    ];

    for (const testCase of insufficient) {
      const response = await action(routeArgs(
        mutationRequest(testCase.method, testCase.path, fixture.readOnlyCredential.token, testCase.requestId, testCase.body),
        testCase.path,
      ));
      expect(response.status).toBe(403);
      expectEnvelopeHeaders(response, testCase.requestId);
      expectErrorEnvelope(await readJson(response), testCase.requestId, "insufficient_scope", 403);
    }
  });
});
