import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { action } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { resolveApiV1ScopeRequirement } from "~/lib/api-v1.server";
import { getLocalDb } from "~/lib/db.server";
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

function expectExactKeys(value: Record<string, unknown>, keys: string[]) {
  expect(Object.keys(value).sort()).toEqual([...keys].sort());
}

function expectEnvelopeHeaders(response: Response, requestId: string) {
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(response.headers.get("X-Request-Id")).toBe(requestId);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type, X-Request-Id");
  expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, PATCH, DELETE, OPTIONS");
  expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id");
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

describe("API v1 shopping-list mutations", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
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
    expectExactKeys(addPayload.data, ["created", "updated", "item", "shoppingList", "mutation"]);
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
    expectShoppingListShape(addPayload.data.shoppingList);
    expect(addPayload.data.shoppingList).toMatchObject({
      id: fixture.list.id,
      chef: { id: fixture.user.id, username: fixture.user.username },
      items: [{ id: addPayload.data.item.id }],
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
    expectExactKeys(checkPayload.data, ["item", "shoppingList", "mutation"]);
    expectShoppingItemShape(checkPayload.data.item);
    expect(checkPayload.data.item).toMatchObject({
      id: addPayload.data.item.id,
      checked: true,
      checkedAt: expect.any(String),
      deletedAt: null,
    });
    expectShoppingListShape(checkPayload.data.shoppingList);
    expect(checkPayload.data.shoppingList.items).toHaveLength(1);
    expect(checkPayload.data.shoppingList.items[0]).toMatchObject({ id: addPayload.data.item.id, checked: true });
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
    expectExactKeys(removePayload.data, ["removed", "item", "shoppingList", "mutation"]);
    expect(removePayload.data.removed).toBe(true);
    expectShoppingItemShape(removePayload.data.item);
    expect(removePayload.data.item).toMatchObject({
      id: addPayload.data.item.id,
      checked: true,
      deletedAt: expect.any(String),
    });
    expectShoppingListShape(removePayload.data.shoppingList);
    expect(removePayload.data.shoppingList.items).toEqual([]);
    expectMutationShape(removePayload.data.mutation, "client-remove-1", false);

    const legacyAdd = await action(routeArgs(
      mutationRequest("POST", "shopping-list/items", fixture.legacyCredential.token, "req_add_item_legacy", {
        clientMutationId: "client-add-legacy",
        name: `Milk ${faker.string.alphanumeric(6)}`,
      }),
      "shopping-list/items",
    ));
    expect(legacyAdd.status).toBe(201);
  });

  it("restores matching items, rejects unknown fields, and requires clientMutationId", async () => {
    const fixture = await createShoppingMutationFixture(db);
    const unit = await getOrCreateUnit(db, `box ${faker.string.alphanumeric(6)}`);
    const ingredientRef = await getOrCreateIngredientRef(db, `restored ${faker.string.alphanumeric(6)}`);
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
    expectExactKeys(restorePayload.data, ["created", "updated", "item", "shoppingList", "mutation"]);
    expect(restorePayload.data).toMatchObject({ created: false, updated: true });
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
