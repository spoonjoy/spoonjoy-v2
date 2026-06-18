import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { action } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import {
  hashIdempotencyRequest,
  idempotencyClientKey,
  reserveIdempotencyKey,
} from "~/lib/api-idempotency.server";
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

function expectRecipeShoppingMutationData(data: any, clientMutationId: string, replayed = false) {
  expectExactKeys(data, ["created", "items", "mutation", "recipe", "updated"]);
  expect(typeof data.created).toBe("number");
  expect(typeof data.updated).toBe("number");
  expectExactKeys(data.recipe, ["id", "title"]);
  expect(Array.isArray(data.items)).toBe(true);
  for (const item of data.items) expectShoppingItemShape(item);
  expectMutationShape(data.mutation, clientMutationId, replayed);
}

function expectClearShoppingMutationData(data: any, clientMutationId: string, replayed = false) {
  expectExactKeys(data, ["cleared", "items", "mutation"]);
  expect(typeof data.cleared).toBe("number");
  expect(Array.isArray(data.items)).toBe(true);
  for (const item of data.items) expectShoppingItemShape(item);
  expectMutationShape(data.mutation, clientMutationId, replayed);
}

function shoppingItemContractSummary(item: any) {
  return {
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    checked: item.checked,
    checkedAt: item.checkedAt,
    deletedAt: item.deletedAt,
    categoryKey: item.categoryKey,
    iconKey: item.iconKey,
  };
}

function sortShoppingItemSummaries(items: any[]) {
  return items.map(shoppingItemContractSummary).sort((left, right) => left.name.localeCompare(right.name));
}

async function reserveShoppingMutation(
  db: Awaited<ReturnType<typeof getLocalDb>>,
  fixture: Awaited<ReturnType<typeof createShoppingMutationFixture>>,
  path: string,
  operation: string,
  body: Record<string, unknown>,
) {
  return await reserveShoppingMutationForPrincipal(db, {
    userId: fixture.user.id,
    credentialId: fixture.credential.credential.id,
  }, path, operation, body);
}

async function reserveShoppingMutationForPrincipal(
  db: Awaited<ReturnType<typeof getLocalDb>>,
  principal: { userId: string; credentialId: string },
  path: string,
  operation: string,
  body: Record<string, unknown>,
) {
  const requestHash = await hashIdempotencyRequest({
    method: "POST",
    path: `/api/v1/${path}`,
    body,
  });
  const reserved = await reserveIdempotencyKey(db, {
    userId: principal.userId,
    credentialId: principal.credentialId,
    clientKey: idempotencyClientKey({
      id: principal.userId,
      source: "bearer",
      credentialId: principal.credentialId,
    }),
    key: String(body.clientMutationId),
    operation,
    requestHash,
  });
  if (reserved.status !== "reserved") throw new Error(`expected ${operation} reservation`);
  return reserved.record;
}

async function createShoppingMutationFixture(db: Awaited<ReturnType<typeof getLocalDb>>) {
  const user = await db.user.create({ data: createTestUser() });
  const otherUser = await db.user.create({ data: createTestUser() });
  const credential = await createApiCredential(db, user.id, "Shopping writer", { scopes: ["shopping_list:write"] });
  const legacyCredential = await createApiCredential(db, user.id, "Legacy shopping writer", { scopes: ["kitchen:write"] });
  const readOnlyCredential = await createApiCredential(db, user.id, "Shopping reader", { scopes: ["shopping_list:read"] });
  const list = await db.shoppingList.create({ data: { authorId: user.id } });
  return { user, otherUser, credential, legacyCredential, readOnlyCredential, list };
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

async function createRecipeWithIngredients(
  db: Awaited<ReturnType<typeof getLocalDb>>,
  chefId: string,
  ingredients: Array<{ name: string; quantity: number; unit: string }>,
) {
  const recipe = await db.recipe.create({
    data: {
      title: `Shopping Recipe ${faker.string.alphanumeric(8)}`,
      chefId,
    },
  });
  await db.recipeStep.create({
    data: { recipeId: recipe.id, stepNum: 1, description: "Add ingredients to shopping list" },
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

  it("adds owner and public recipe ingredients with scale, merge, restore, and exact mutation envelopes", async () => {
    const fixture = await createShoppingMutationFixture(db);
    const existingUnitName = `cup_bulk_${faker.string.alphanumeric(6)}`.toLowerCase();
    const existingIngredientName = `flour_bulk_${faker.string.alphanumeric(6)}`.toLowerCase();
    const newUnitName = `tsp_bulk_${faker.string.alphanumeric(6)}`.toLowerCase();
    const newIngredientName = `salt_bulk_${faker.string.alphanumeric(6)}`.toLowerCase();
    const existingUnit = await getOrCreateUnit(db, existingUnitName);
    const existingIngredient = await getOrCreateIngredientRef(db, existingIngredientName);
    const existingItem = await db.shoppingListItem.create({
      data: {
        shoppingListId: fixture.list.id,
        ingredientRefId: existingIngredient.id,
        unitId: existingUnit.id,
        quantity: 1,
        checked: true,
        checkedAt: new Date(),
        deletedAt: new Date(),
        sortIndex: 0,
        categoryKey: "pantry",
        iconKey: "bag",
      },
    });
    const ownerRecipe = await createRecipeWithIngredients(db, fixture.user.id, [
      { name: existingIngredientName, quantity: 1.5, unit: existingUnitName },
      { name: newIngredientName, quantity: 2, unit: newUnitName },
    ]);
    const addOwnerBody = {
      clientMutationId: "bulk-add-owner-recipe",
      recipeId: ownerRecipe.id,
      scaleFactor: 2,
    };

    const addOwner = await action(routeArgs(
      mutationRequest("POST", "shopping-list/add-from-recipe", fixture.credential.token, "req_bulk_add_owner_recipe", addOwnerBody),
      "shopping-list/add-from-recipe",
    ));
    const addOwnerPayload = await readJson(addOwner);

    expect(addOwner.status).toBe(200);
    expectEnvelopeHeaders(addOwner, "req_bulk_add_owner_recipe");
    expectSuccessEnvelope(addOwnerPayload, "req_bulk_add_owner_recipe");
    expectRecipeShoppingMutationData(addOwnerPayload.data, "bulk-add-owner-recipe");
    expect(addOwnerPayload.data).toMatchObject({
      created: 1,
      updated: 1,
      recipe: { id: ownerRecipe.id, title: ownerRecipe.title },
    });
    const ownerItemSummaries = sortShoppingItemSummaries(addOwnerPayload.data.items);
    expect(ownerItemSummaries).toHaveLength(2);
    expect(ownerItemSummaries).toEqual([
      {
        id: existingItem.id,
        name: existingIngredientName,
        quantity: 4,
        unit: existingUnitName,
        checked: false,
        checkedAt: null,
        deletedAt: null,
        categoryKey: "pantry",
        iconKey: expect.any(String),
      },
      {
        id: expect.any(String),
        name: newIngredientName,
        quantity: 4,
        unit: newUnitName,
        checked: false,
        checkedAt: null,
        deletedAt: null,
        categoryKey: expect.any(String),
        iconKey: expect.any(String),
      },
    ].sort((left, right) => left.name.localeCompare(right.name)));
    expect(ownerItemSummaries.find((item) => item.name === newIngredientName)?.id).not.toBe(existingItem.id);

    const replayOwner = await action(routeArgs(
      mutationRequest("POST", "shopping-list/add-from-recipe", fixture.credential.token, "req_bulk_add_owner_recipe_replay", addOwnerBody),
      "shopping-list/add-from-recipe",
    ));
    const replayOwnerPayload = await readJson(replayOwner);
    const expectedReplay = structuredClone(addOwnerPayload);
    expectedReplay.requestId = "req_bulk_add_owner_recipe_replay";
    expectedReplay.data.mutation.replayed = true;

    expect(replayOwner.status).toBe(200);
    expect(replayOwnerPayload).toEqual(expectedReplay);

    const conflict = await action(routeArgs(
      mutationRequest("POST", "shopping-list/add-from-recipe", fixture.credential.token, "req_bulk_add_owner_recipe_conflict", {
        ...addOwnerBody,
        scaleFactor: 3,
      }),
      "shopping-list/add-from-recipe",
    ));
    expect(conflict.status).toBe(409);
    expectEnvelopeHeaders(conflict, "req_bulk_add_owner_recipe_conflict");
    expectErrorEnvelope(await readJson(conflict), "req_bulk_add_owner_recipe_conflict", "idempotency_conflict", 409);

    const publicIngredientName = `public_oats_${faker.string.alphanumeric(6)}`.toLowerCase();
    const publicUnitName = `bag_public_${faker.string.alphanumeric(6)}`.toLowerCase();
    const publicRecipe = await createRecipeWithIngredients(db, fixture.otherUser.id, [
      { name: publicIngredientName, quantity: 5, unit: publicUnitName },
    ]);
    const addPublic = await action(routeArgs(
      mutationRequest("POST", "shopping-list/add-from-recipe", fixture.credential.token, "req_bulk_add_public_recipe", {
        clientMutationId: "bulk-add-public-recipe",
        recipeId: publicRecipe.id,
      }),
      "shopping-list/add-from-recipe",
    ));
    const addPublicPayload = await readJson(addPublic);

    expect(addPublic.status).toBe(200);
    expectSuccessEnvelope(addPublicPayload, "req_bulk_add_public_recipe");
    expectRecipeShoppingMutationData(addPublicPayload.data, "bulk-add-public-recipe");
    expect(addPublicPayload.data).toMatchObject({
      created: 1,
      updated: 0,
      recipe: { id: publicRecipe.id, title: publicRecipe.title },
    });
    expect(addPublicPayload.data.items).toEqual([
      expect.objectContaining({ name: publicIngredientName, quantity: 5, unit: publicUnitName }),
    ]);

    const activeMergeName = `active_merge_rice_${faker.string.alphanumeric(6)}`.toLowerCase();
    const activeMergeUnitName = `scoop_active_${faker.string.alphanumeric(6)}`.toLowerCase();
    const activeMergeUnit = await getOrCreateUnit(db, activeMergeUnitName);
    const activeMergeIngredient = await getOrCreateIngredientRef(db, activeMergeName);
    const activeMergeItem = await db.shoppingListItem.create({
      data: {
        shoppingListId: fixture.list.id,
        ingredientRefId: activeMergeIngredient.id,
        unitId: activeMergeUnit.id,
        quantity: null,
        checked: false,
        checkedAt: null,
        deletedAt: null,
        sortIndex: 17,
        categoryKey: null,
        iconKey: null,
      },
    });
    const activeMergeRecipe = await createRecipeWithIngredients(db, fixture.user.id, [
      { name: activeMergeName, quantity: 3, unit: activeMergeUnitName },
    ]);
    const activeMerge = await action(routeArgs(
      mutationRequest("POST", "shopping-list/add-from-recipe", fixture.credential.token, "req_bulk_add_active_merge", {
        clientMutationId: "bulk-add-active-merge",
        recipeId: activeMergeRecipe.id,
      }),
      "shopping-list/add-from-recipe",
    ));
    const activeMergePayload = await readJson(activeMerge);

    expect(activeMerge.status).toBe(200);
    expect(activeMergePayload.data).toMatchObject({
      created: 0,
      updated: 1,
      items: [expect.objectContaining({
        id: activeMergeItem.id,
        quantity: 3,
        sortIndex: 17,
        checked: false,
        checkedAt: null,
        deletedAt: null,
      })],
    });
  });

  it("coalesces duplicate recipe ingredients into one exact final changed row", async () => {
    const fixture = await createShoppingMutationFixture(db);
    const ingredientName = `duplicate_rice_${faker.string.alphanumeric(6)}`.toLowerCase();
    const unitName = `bag_duplicate_${faker.string.alphanumeric(6)}`.toLowerCase();
    const recipe = await createRecipeWithIngredients(db, fixture.user.id, [
      { name: ingredientName, quantity: 1, unit: unitName },
      { name: ingredientName, quantity: 2, unit: unitName },
    ]);

    const add = await action(routeArgs(
      mutationRequest("POST", "shopping-list/add-from-recipe", fixture.credential.token, "req_bulk_add_duplicate_recipe", {
        clientMutationId: "bulk-add-duplicate-recipe",
        recipeId: recipe.id,
        scaleFactor: 2,
      }),
      "shopping-list/add-from-recipe",
    ));
    const payload = await readJson(add);

    expect(add.status).toBe(200);
    expectSuccessEnvelope(payload, "req_bulk_add_duplicate_recipe");
    expectRecipeShoppingMutationData(payload.data, "bulk-add-duplicate-recipe");
    expect(payload.data).toMatchObject({
      created: 1,
      updated: 0,
      recipe: { id: recipe.id, title: recipe.title },
    });
    expect(payload.data.items).toEqual([
      expect.objectContaining({
        name: ingredientName,
        unit: unitName,
        quantity: 6,
        checked: false,
        checkedAt: null,
        deletedAt: null,
      }),
    ]);
    await expect(db.shoppingListItem.count({
      where: { shoppingListId: fixture.list.id, ingredientRef: { name: ingredientName } },
    })).resolves.toBe(1);
  });

  it("handles recipe-add empty ingredients and clear operations with checked, deleted, and empty-list rows", async () => {
    const fixture = await createShoppingMutationFixture(db);
    const emptyRecipe = await db.recipe.create({
      data: { title: `Empty Shopping Recipe ${faker.string.alphanumeric(8)}`, chefId: fixture.user.id },
    });
    await db.recipeStep.create({
      data: { recipeId: emptyRecipe.id, stepNum: 1, description: "No ingredients today" },
    });

    const emptyAdd = await action(routeArgs(
      mutationRequest("POST", "shopping-list/add-from-recipe", fixture.credential.token, "req_bulk_add_empty_recipe", {
        clientMutationId: "bulk-add-empty-recipe",
        recipeId: emptyRecipe.id,
      }),
      "shopping-list/add-from-recipe",
    ));
    const emptyAddPayload = await readJson(emptyAdd);
    expect(emptyAdd.status).toBe(200);
    expectSuccessEnvelope(emptyAddPayload, "req_bulk_add_empty_recipe");
    expectRecipeShoppingMutationData(emptyAddPayload.data, "bulk-add-empty-recipe");
    expect(emptyAddPayload.data).toMatchObject({
      created: 0,
      updated: 0,
      items: [],
      recipe: { id: emptyRecipe.id, title: emptyRecipe.title },
    });

    const unchecked = await createExistingItem(db, fixture.user.id, `Unchecked Carrots ${faker.string.alphanumeric(6)}`);
    const checked = await createExistingItem(db, fixture.user.id, `Checked Kale ${faker.string.alphanumeric(6)}`);
    const legacyChecked = await createExistingItem(db, fixture.user.id, `Legacy Checked Beans ${faker.string.alphanumeric(6)}`);
    const alreadyDeleted = await createExistingItem(db, fixture.user.id, `Deleted Lentils ${faker.string.alphanumeric(6)}`);
    await db.shoppingListItem.update({
      where: { id: checked.id },
      data: { checked: true, checkedAt: new Date(), sortIndex: 1 },
    });
    await db.shoppingListItem.update({
      where: { id: legacyChecked.id },
      data: { checked: true, checkedAt: null, sortIndex: 2 },
    });
    await db.shoppingListItem.update({
      where: { id: alreadyDeleted.id },
      data: { checked: true, checkedAt: new Date(), deletedAt: new Date(), sortIndex: 3 },
    });

    const clearCompletedBody = { clientMutationId: "bulk-clear-completed" };
    const clearCompleted = await action(routeArgs(
      mutationRequest("POST", "shopping-list/clear-completed", fixture.credential.token, "req_clear_completed", clearCompletedBody),
      "shopping-list/clear-completed",
    ));
    const clearCompletedPayload = await readJson(clearCompleted);

    expect(clearCompleted.status).toBe(200);
    expectEnvelopeHeaders(clearCompleted, "req_clear_completed");
    expectSuccessEnvelope(clearCompletedPayload, "req_clear_completed");
    expectClearShoppingMutationData(clearCompletedPayload.data, "bulk-clear-completed");
    expect(clearCompletedPayload.data.cleared).toBe(2);
    expect(clearCompletedPayload.data.items.map((item: { id: string }) => item.id).sort()).toEqual([checked.id, legacyChecked.id].sort());
    expect(clearCompletedPayload.data.items.every((item: { deletedAt: string | null }) => item.deletedAt)).toBe(true);
    await expect(db.shoppingListItem.findMany({
      where: { shoppingListId: fixture.list.id, deletedAt: null },
      orderBy: { id: "asc" },
    })).resolves.toEqual([expect.objectContaining({ id: unchecked.id })]);

    const replayClearCompleted = await action(routeArgs(
      mutationRequest("POST", "shopping-list/clear-completed", fixture.credential.token, "req_clear_completed_replay", clearCompletedBody),
      "shopping-list/clear-completed",
    ));
    const replayClearCompletedPayload = await readJson(replayClearCompleted);
    const expectedClearReplay = structuredClone(clearCompletedPayload);
    expectedClearReplay.requestId = "req_clear_completed_replay";
    expectedClearReplay.data.mutation.replayed = true;
    expect(replayClearCompleted.status).toBe(200);
    expect(replayClearCompletedPayload).toEqual(expectedClearReplay);

    const clearCompletedConflict = await action(routeArgs(
      mutationRequest("POST", "shopping-list/clear-all", fixture.credential.token, "req_clear_completed_conflict", clearCompletedBody),
      "shopping-list/clear-all",
    ));
    expect(clearCompletedConflict.status).toBe(409);
    expectEnvelopeHeaders(clearCompletedConflict, "req_clear_completed_conflict");
    expectErrorEnvelope(await readJson(clearCompletedConflict), "req_clear_completed_conflict", "idempotency_conflict", 409);

    const clearAllBody = { clientMutationId: "bulk-clear-all" };
    const clearAll = await action(routeArgs(
      mutationRequest("POST", "shopping-list/clear-all", fixture.credential.token, "req_clear_all", clearAllBody),
      "shopping-list/clear-all",
    ));
    const clearAllPayload = await readJson(clearAll);

    expect(clearAll.status).toBe(200);
    expectEnvelopeHeaders(clearAll, "req_clear_all");
    expectSuccessEnvelope(clearAllPayload, "req_clear_all");
    expectClearShoppingMutationData(clearAllPayload.data, "bulk-clear-all");
    expect(clearAllPayload.data).toMatchObject({
      cleared: 1,
      items: [expect.objectContaining({ id: unchecked.id, deletedAt: expect.any(String) })],
    });
    await expect(db.shoppingListItem.count({
      where: { shoppingListId: fixture.list.id, deletedAt: null },
    })).resolves.toBe(0);

    const replayClearAll = await action(routeArgs(
      mutationRequest("POST", "shopping-list/clear-all", fixture.credential.token, "req_clear_all_replay", clearAllBody),
      "shopping-list/clear-all",
    ));
    const replayClearAllPayload = await readJson(replayClearAll);
    const expectedClearAllReplay = structuredClone(clearAllPayload);
    expectedClearAllReplay.requestId = "req_clear_all_replay";
    expectedClearAllReplay.data.mutation.replayed = true;
    expect(replayClearAll.status).toBe(200);
    expect(replayClearAllPayload).toEqual(expectedClearAllReplay);

    const clearAllConflict = await action(routeArgs(
      mutationRequest("POST", "shopping-list/clear-completed", fixture.credential.token, "req_clear_all_conflict", clearAllBody),
      "shopping-list/clear-completed",
    ));
    expect(clearAllConflict.status).toBe(409);
    expectEnvelopeHeaders(clearAllConflict, "req_clear_all_conflict");
    expectErrorEnvelope(await readJson(clearAllConflict), "req_clear_all_conflict", "idempotency_conflict", 409);

    const clearEmpty = await action(routeArgs(
      mutationRequest("POST", "shopping-list/clear-all", fixture.credential.token, "req_clear_all_empty", {
        clientMutationId: "bulk-clear-all-empty",
      }),
      "shopping-list/clear-all",
    ));
    const clearEmptyPayload = await readJson(clearEmpty);
    expect(clearEmpty.status).toBe(200);
    expectSuccessEnvelope(clearEmptyPayload, "req_clear_all_empty");
    expectClearShoppingMutationData(clearEmptyPayload.data, "bulk-clear-all-empty");
    expect(clearEmptyPayload.data).toMatchObject({ cleared: 0, items: [] });
  });

  it("enforces auth, scope, and body validation for shopping parity mutations", async () => {
    const fixture = await createShoppingMutationFixture(db);
    const recipe = await createRecipeWithIngredients(db, fixture.user.id, [
      {
        name: `validation_oats_${faker.string.alphanumeric(6)}`.toLowerCase(),
        quantity: 1,
        unit: `box_validation_${faker.string.alphanumeric(6)}`.toLowerCase(),
      },
    ]);

    const missingAuth = await action(routeArgs(new UndiciRequest("http://localhost/api/v1/shopping-list/add-from-recipe", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": "req_bulk_missing_auth" },
      body: JSON.stringify({ clientMutationId: "bulk-missing-auth", recipeId: recipe.id }),
    }) as unknown as Request, "shopping-list/add-from-recipe"));
    expect(missingAuth.status).toBe(401);
    expectEnvelopeHeaders(missingAuth, "req_bulk_missing_auth");
    expectErrorEnvelope(await readJson(missingAuth), "req_bulk_missing_auth", "authentication_required", 401);

    const insufficientScope = await action(routeArgs(
      mutationRequest("POST", "shopping-list/clear-all", fixture.readOnlyCredential.token, "req_bulk_missing_scope", {
        clientMutationId: "bulk-missing-scope",
        unexpected: true,
      }),
      "shopping-list/clear-all",
    ));
    expect(insufficientScope.status).toBe(403);
    expectEnvelopeHeaders(insufficientScope, "req_bulk_missing_scope");
    expectErrorEnvelope(await readJson(insufficientScope), "req_bulk_missing_scope", "insufficient_scope", 403);

    const validationCases = [
      {
        path: "shopping-list/add-from-recipe",
        requestId: "req_bulk_add_missing_mutation",
        body: { recipeId: recipe.id },
      },
      {
        path: "shopping-list/add-from-recipe",
        requestId: "req_bulk_add_missing_recipe",
        body: { clientMutationId: "bulk-missing-recipe" },
      },
      {
        path: "shopping-list/add-from-recipe",
        requestId: "req_bulk_add_bad_scale",
        body: { clientMutationId: "bulk-bad-scale", recipeId: recipe.id, scaleFactor: 0 },
      },
      {
        path: "shopping-list/add-from-recipe",
        requestId: "req_bulk_add_unknown",
        body: { clientMutationId: "bulk-add-unknown", recipeId: recipe.id, unknown: true },
      },
      {
        path: "shopping-list/clear-completed",
        requestId: "req_bulk_clear_completed_unknown",
        body: { clientMutationId: "bulk-clear-completed-unknown", unknown: true },
      },
      {
        path: "shopping-list/clear-all",
        requestId: "req_bulk_clear_all_blank_mutation",
        body: { clientMutationId: " " },
      },
    ];

    for (const testCase of validationCases) {
      const response = await action(routeArgs(
        mutationRequest("POST", testCase.path, fixture.credential.token, testCase.requestId, testCase.body),
        testCase.path,
      ));
      expect(response.status).toBe(400);
      expectEnvelopeHeaders(response, testCase.requestId);
      expectErrorEnvelope(await readJson(response), testCase.requestId, "validation_error", 400);
    }

    const userWithoutList = await db.user.create({ data: createTestUser() });
    const credentialWithoutList = await createApiCredential(db, userWithoutList.id, "Shopping writer no list", { scopes: ["shopping_list:write"] });
    const missingRecipe = await action(routeArgs(
      mutationRequest("POST", "shopping-list/add-from-recipe", credentialWithoutList.token, "req_bulk_add_not_found", {
        clientMutationId: "bulk-recipe-not-found",
        recipeId: "missing-recipe",
      }),
      "shopping-list/add-from-recipe",
    ));
    expect(missingRecipe.status).toBe(404);
    expectEnvelopeHeaders(missingRecipe, "req_bulk_add_not_found");
    expectErrorEnvelope(await readJson(missingRecipe), "req_bulk_add_not_found", "not_found", 404);
    await expect(db.shoppingList.count({ where: { authorId: userWithoutList.id } })).resolves.toBe(0);
    await expect(db.shoppingListItem.count({
      where: { shoppingList: { authorId: userWithoutList.id } },
    })).resolves.toBe(0);

    const deletedRecipe = await createRecipeWithIngredients(db, userWithoutList.id, [
      {
        name: `deleted_recipe_oats_${faker.string.alphanumeric(6)}`.toLowerCase(),
        quantity: 1,
        unit: `box_deleted_${faker.string.alphanumeric(6)}`.toLowerCase(),
      },
    ]);
    await db.recipe.update({ where: { id: deletedRecipe.id }, data: { deletedAt: new Date() } });
    const deletedRecipeResponse = await action(routeArgs(
      mutationRequest("POST", "shopping-list/add-from-recipe", credentialWithoutList.token, "req_bulk_add_deleted_recipe", {
        clientMutationId: "bulk-deleted-recipe",
        recipeId: deletedRecipe.id,
      }),
      "shopping-list/add-from-recipe",
    ));
    expect(deletedRecipeResponse.status).toBe(404);
    expectEnvelopeHeaders(deletedRecipeResponse, "req_bulk_add_deleted_recipe");
    expectErrorEnvelope(await readJson(deletedRecipeResponse), "req_bulk_add_deleted_recipe", "not_found", 404);
    await expect(db.shoppingList.count({ where: { authorId: userWithoutList.id } })).resolves.toBe(0);
    await expect(db.shoppingListItem.count({
      where: { shoppingList: { authorId: userWithoutList.id } },
    })).resolves.toBe(0);
  });

  it("recovers committed incomplete bulk mutations and refuses partial recipe-add recovery", async () => {
    const fixture = await createShoppingMutationFixture(db);
    const firstName = `recover_flour_${faker.string.alphanumeric(6)}`.toLowerCase();
    const firstUnit = `cup_recover_${faker.string.alphanumeric(6)}`.toLowerCase();
    const secondName = `recover_sugar_${faker.string.alphanumeric(6)}`.toLowerCase();
    const secondUnit = `tbsp_recover_${faker.string.alphanumeric(6)}`.toLowerCase();
    const recipe = await createRecipeWithIngredients(db, fixture.user.id, [
      { name: firstName, quantity: 2, unit: firstUnit },
      { name: secondName, quantity: 3, unit: secondUnit },
    ]);
    const addBody = {
      clientMutationId: "bulk-recover-add-recipe",
      recipeId: recipe.id,
      scaleFactor: 2,
    };
    const addReservation = await reserveShoppingMutation(
      db,
      fixture,
      "shopping-list/add-from-recipe",
      "shopping-list.add-from-recipe",
      addBody,
    );
    const firstUnitRow = await getOrCreateUnit(db, firstUnit);
    const firstRef = await getOrCreateIngredientRef(db, firstName);
    const secondUnitRow = await getOrCreateUnit(db, secondUnit);
    const secondRef = await getOrCreateIngredientRef(db, secondName);
    const recoveredAddItems = await Promise.all([
      db.shoppingListItem.create({
        data: {
          shoppingListId: fixture.list.id,
          ingredientRefId: firstRef.id,
          unitId: firstUnitRow.id,
          quantity: 4,
          sortIndex: 0,
        },
      }),
      db.shoppingListItem.create({
        data: {
          shoppingListId: fixture.list.id,
          ingredientRefId: secondRef.id,
          unitId: secondUnitRow.id,
          quantity: 6,
          sortIndex: 1,
        },
      }),
    ]);
    for (const item of recoveredAddItems) {
      await db.apiMutationTombstone.create({
        data: {
          idempotencyKeyId: addReservation.id,
          operation: "shopping-list.add-from-recipe",
          resourceType: "shopping_list_item",
          resourceId: item.id,
          parentResourceId: recipe.id,
          payload: JSON.stringify({ created: true }),
        },
      });
    }

    const recoveredAdd = await action(routeArgs(
      mutationRequest("POST", "shopping-list/add-from-recipe", fixture.credential.token, "req_recover_bulk_add", addBody),
      "shopping-list/add-from-recipe",
    ));
    const recoveredAddPayload = await readJson(recoveredAdd);
    expect(recoveredAdd.status).toBe(200);
    expectRecipeShoppingMutationData(recoveredAddPayload.data, "bulk-recover-add-recipe", true);
    expect(recoveredAddPayload.data).toMatchObject({
      created: 2,
      updated: 0,
      recipe: { id: recipe.id, title: recipe.title },
    });
    expect(sortShoppingItemSummaries(recoveredAddPayload.data.items)).toEqual([
      {
        id: recoveredAddItems[0]!.id,
        name: firstName,
        quantity: 4,
        unit: firstUnit,
        checked: false,
        checkedAt: null,
        deletedAt: null,
        categoryKey: null,
        iconKey: null,
      },
      {
        id: recoveredAddItems[1]!.id,
        name: secondName,
        quantity: 6,
        unit: secondUnit,
        checked: false,
        checkedAt: null,
        deletedAt: null,
        categoryKey: null,
        iconKey: null,
      },
    ].sort((left, right) => left.name.localeCompare(right.name)));

    const partialBody = {
      clientMutationId: "bulk-partial-add-recipe",
      recipeId: recipe.id,
    };
    const partialReservation = await reserveShoppingMutation(
      db,
      fixture,
      "shopping-list/add-from-recipe",
      "shopping-list.add-from-recipe",
      partialBody,
    );
    await db.apiMutationTombstone.create({
      data: {
        idempotencyKeyId: partialReservation.id,
        operation: "shopping-list.add-from-recipe",
        resourceType: "shopping_list_item",
        resourceId: recoveredAddItems[0]!.id,
        parentResourceId: recipe.id,
        payload: JSON.stringify({ created: false }),
      },
    });
    const partialRecovery = await action(routeArgs(
      mutationRequest("POST", "shopping-list/add-from-recipe", fixture.credential.token, "req_partial_bulk_add", partialBody),
      "shopping-list/add-from-recipe",
    ));
    expect(partialRecovery.status).toBe(409);
    expectErrorEnvelope(await readJson(partialRecovery), "req_partial_bulk_add", "idempotency_in_progress", 409);

    const updateName = `recover_update_oats_${faker.string.alphanumeric(6)}`.toLowerCase();
    const updateUnit = `cup_update_${faker.string.alphanumeric(6)}`.toLowerCase();
    const updateRecipe = await createRecipeWithIngredients(db, fixture.user.id, [
      { name: updateName, quantity: 2, unit: updateUnit },
    ]);
    const updateBody = {
      clientMutationId: "bulk-recover-add-existing",
      recipeId: updateRecipe.id,
    };
    const updateReservation = await reserveShoppingMutation(
      db,
      fixture,
      "shopping-list/add-from-recipe",
      "shopping-list.add-from-recipe",
      updateBody,
    );
    const updateUnitRow = await getOrCreateUnit(db, updateUnit);
    const updateRef = await getOrCreateIngredientRef(db, updateName);
    const updatedItem = await db.shoppingListItem.create({
      data: {
        shoppingListId: fixture.list.id,
        ingredientRefId: updateRef.id,
        unitId: updateUnitRow.id,
        quantity: 7,
        sortIndex: 2,
      },
    });
    await db.apiMutationTombstone.create({
      data: {
        idempotencyKeyId: updateReservation.id,
        operation: "shopping-list.add-from-recipe",
        resourceType: "shopping_list_item",
        resourceId: updatedItem.id,
        parentResourceId: updateRecipe.id,
        payload: JSON.stringify({ created: false }),
      },
    });
    const recoveredUpdatedAdd = await action(routeArgs(
      mutationRequest("POST", "shopping-list/add-from-recipe", fixture.credential.token, "req_recover_bulk_add_update", updateBody),
      "shopping-list/add-from-recipe",
    ));
    const recoveredUpdatedPayload = await readJson(recoveredUpdatedAdd);
    expect(recoveredUpdatedAdd.status).toBe(200);
    expect(recoveredUpdatedPayload.data).toMatchObject({
      created: 0,
      updated: 1,
      items: [expect.objectContaining({ id: updatedItem.id, quantity: 7 })],
    });

    for (const [clientMutationId, requestId, tombstone] of [
      ["bulk-recover-add-missing-item", "req_recover_add_missing_item", {
        resourceId: "missing-shopping-item",
        payload: JSON.stringify({ created: true }),
      }],
      ["bulk-recover-add-wrong-item", "req_recover_add_wrong_item", {
        resourceId: recoveredAddItems[0]!.id,
        payload: JSON.stringify({ created: true }),
      }],
      ["bulk-recover-add-bad-payload", "req_recover_add_bad_payload", {
        resourceId: updatedItem.id,
        payload: JSON.stringify({ nope: true }),
      }],
      ["bulk-recover-add-malformed-payload", "req_recover_add_malformed_payload", {
        resourceId: updatedItem.id,
        payload: "{",
      }],
      ["bulk-recover-add-null-payload", "req_recover_add_null_payload", {
        resourceId: updatedItem.id,
        payload: null,
      }],
    ] as const) {
      const body = {
        clientMutationId,
        recipeId: updateRecipe.id,
      };
      const reservation = await reserveShoppingMutation(
        db,
        fixture,
        "shopping-list/add-from-recipe",
        "shopping-list.add-from-recipe",
        body,
      );
      await db.apiMutationTombstone.create({
        data: {
          idempotencyKeyId: reservation.id,
          operation: "shopping-list.add-from-recipe",
          resourceType: "shopping_list_item",
          resourceId: tombstone.resourceId,
          parentResourceId: updateRecipe.id,
          payload: tombstone.payload,
        },
      });
      const response = await action(routeArgs(
        mutationRequest("POST", "shopping-list/add-from-recipe", fixture.credential.token, requestId, body),
        "shopping-list/add-from-recipe",
      ));
      expect(response.status).toBe(409);
      expectErrorEnvelope(await readJson(response), requestId, "idempotency_in_progress", 409);
    }

    const noListUser = await db.user.create({ data: createTestUser() });
    const noListCredential = await createApiCredential(db, noListUser.id, "Shopping recovery no list", { scopes: ["shopping_list:write"] });
    const noListRecipe = await createRecipeWithIngredients(db, noListUser.id, [
      { name: `recover_no_list_${faker.string.alphanumeric(6)}`.toLowerCase(), quantity: 1, unit: "each" },
    ]);
    const noListBody = {
      clientMutationId: "bulk-recover-add-no-list",
      recipeId: noListRecipe.id,
    };
    await reserveShoppingMutationForPrincipal(db, {
      userId: noListUser.id,
      credentialId: noListCredential.credential.id,
    }, "shopping-list/add-from-recipe", "shopping-list.add-from-recipe", noListBody);
    const noListRecovery = await action(routeArgs(
      mutationRequest("POST", "shopping-list/add-from-recipe", noListCredential.token, "req_recover_add_no_list", noListBody),
      "shopping-list/add-from-recipe",
    ));
    expect(noListRecovery.status).toBe(409);
    expectErrorEnvelope(await readJson(noListRecovery), "req_recover_add_no_list", "idempotency_in_progress", 409);

    const missingRecipeBody = {
      clientMutationId: "bulk-recover-add-missing-recipe",
      recipeId: "missing-recipe",
    };
    await reserveShoppingMutation(
      db,
      fixture,
      "shopping-list/add-from-recipe",
      "shopping-list.add-from-recipe",
      missingRecipeBody,
    );
    const missingRecipeRecovery = await action(routeArgs(
      mutationRequest("POST", "shopping-list/add-from-recipe", fixture.credential.token, "req_recover_add_missing_recipe", missingRecipeBody),
      "shopping-list/add-from-recipe",
    ));
    expect(missingRecipeRecovery.status).toBe(409);
    expectErrorEnvelope(await readJson(missingRecipeRecovery), "req_recover_add_missing_recipe", "idempotency_in_progress", 409);

    const checked = await createExistingItem(db, fixture.user.id, `Recover Checked ${faker.string.alphanumeric(6)}`);
    await db.shoppingListItem.update({
      where: { id: checked.id },
      data: { checked: true, checkedAt: new Date(), deletedAt: new Date() },
    });
    const clearCompletedBody = { clientMutationId: "bulk-recover-clear-completed" };
    const clearCompletedReservation = await reserveShoppingMutation(
      db,
      fixture,
      "shopping-list/clear-completed",
      "shopping-list.clear-completed",
      clearCompletedBody,
    );
    await db.apiMutationTombstone.create({
      data: {
        idempotencyKeyId: clearCompletedReservation.id,
        operation: "shopping-list.clear-completed",
        resourceType: "shopping_list_item",
        resourceId: checked.id,
        payload: JSON.stringify({ cleared: true }),
      },
    });

    const recoveredClearCompleted = await action(routeArgs(
      mutationRequest("POST", "shopping-list/clear-completed", fixture.credential.token, "req_recover_clear_completed", clearCompletedBody),
      "shopping-list/clear-completed",
    ));
    const recoveredClearCompletedPayload = await readJson(recoveredClearCompleted);
    expect(recoveredClearCompleted.status).toBe(200);
    expectClearShoppingMutationData(recoveredClearCompletedPayload.data, "bulk-recover-clear-completed", true);
    expect(recoveredClearCompletedPayload.data).toMatchObject({
      cleared: 1,
      items: [expect.objectContaining({ id: checked.id, deletedAt: expect.any(String) })],
    });

    const active = await createExistingItem(db, fixture.user.id, `Recover Active ${faker.string.alphanumeric(6)}`);
    await db.shoppingListItem.update({
      where: { id: active.id },
      data: { deletedAt: new Date() },
    });
    const clearAllBody = { clientMutationId: "bulk-recover-clear-all" };
    const clearAllReservation = await reserveShoppingMutation(
      db,
      fixture,
      "shopping-list/clear-all",
      "shopping-list.clear-all",
      clearAllBody,
    );
    await db.apiMutationTombstone.create({
      data: {
        idempotencyKeyId: clearAllReservation.id,
        operation: "shopping-list.clear-all",
        resourceType: "shopping_list_item",
        resourceId: active.id,
        payload: JSON.stringify({ cleared: true }),
      },
    });
    const recoveredClearAll = await action(routeArgs(
      mutationRequest("POST", "shopping-list/clear-all", fixture.credential.token, "req_recover_clear_all", clearAllBody),
      "shopping-list/clear-all",
    ));
    const recoveredClearAllPayload = await readJson(recoveredClearAll);
    expect(recoveredClearAll.status).toBe(200);
    expectClearShoppingMutationData(recoveredClearAllPayload.data, "bulk-recover-clear-all", true);
    expect(recoveredClearAllPayload.data).toMatchObject({
      cleared: 1,
      items: [expect.objectContaining({ id: active.id, deletedAt: expect.any(String) })],
    });

    const emptyClearCompletedBody = { clientMutationId: "bulk-empty-clear-completed-recovery" };
    await reserveShoppingMutation(
      db,
      fixture,
      "shopping-list/clear-completed",
      "shopping-list.clear-completed",
      emptyClearCompletedBody,
    );
    const emptyClearCompleted = await action(routeArgs(
      mutationRequest("POST", "shopping-list/clear-completed", fixture.credential.token, "req_empty_clear_completed_recovery", emptyClearCompletedBody),
      "shopping-list/clear-completed",
    ));
    expect(emptyClearCompleted.status).toBe(200);
    expectClearShoppingMutationData((await readJson(emptyClearCompleted)).data, "bulk-empty-clear-completed-recovery", true);

    const checkedWithoutJournal = await createExistingItem(db, fixture.user.id, `Recover Active Checked ${faker.string.alphanumeric(6)}`);
    await db.shoppingListItem.update({
      where: { id: checkedWithoutJournal.id },
      data: { checked: true, checkedAt: new Date() },
    });
    const activeClearCompletedBody = { clientMutationId: "bulk-active-clear-completed-recovery" };
    await reserveShoppingMutation(
      db,
      fixture,
      "shopping-list/clear-completed",
      "shopping-list.clear-completed",
      activeClearCompletedBody,
    );
    const activeClearCompleted = await action(routeArgs(
      mutationRequest("POST", "shopping-list/clear-completed", fixture.credential.token, "req_active_clear_completed_recovery", activeClearCompletedBody),
      "shopping-list/clear-completed",
    ));
    expect(activeClearCompleted.status).toBe(409);
    expectErrorEnvelope(await readJson(activeClearCompleted), "req_active_clear_completed_recovery", "idempotency_in_progress", 409);
    await db.shoppingListItem.update({ where: { id: checkedWithoutJournal.id }, data: { deletedAt: new Date() } });

    const activeWithoutJournal = await createExistingItem(db, fixture.user.id, `Recover Active Unjournaled ${faker.string.alphanumeric(6)}`);
    const activeClearAllBody = { clientMutationId: "bulk-active-clear-all-recovery" };
    await reserveShoppingMutation(
      db,
      fixture,
      "shopping-list/clear-all",
      "shopping-list.clear-all",
      activeClearAllBody,
    );
    const activeClearAll = await action(routeArgs(
      mutationRequest("POST", "shopping-list/clear-all", fixture.credential.token, "req_active_clear_all_recovery", activeClearAllBody),
      "shopping-list/clear-all",
    ));
    expect(activeClearAll.status).toBe(409);
    expectErrorEnvelope(await readJson(activeClearAll), "req_active_clear_all_recovery", "idempotency_in_progress", 409);
    await db.shoppingListItem.update({ where: { id: activeWithoutJournal.id }, data: { deletedAt: new Date() } });

    const noListClearAllBody = { clientMutationId: "bulk-clear-all-no-list" };
    await reserveShoppingMutationForPrincipal(db, {
      userId: noListUser.id,
      credentialId: noListCredential.credential.id,
    }, "shopping-list/clear-all", "shopping-list.clear-all", noListClearAllBody);
    const noListClearAll = await action(routeArgs(
      mutationRequest("POST", "shopping-list/clear-all", noListCredential.token, "req_clear_all_no_list_recovery", noListClearAllBody),
      "shopping-list/clear-all",
    ));
    expect(noListClearAll.status).toBe(409);
    expectErrorEnvelope(await readJson(noListClearAll), "req_clear_all_no_list_recovery", "idempotency_in_progress", 409);

    const noListClearSuccess = await action(routeArgs(
      mutationRequest("POST", "shopping-list/clear-completed", noListCredential.token, "req_clear_completed_no_list_success", {
        clientMutationId: "bulk-clear-completed-no-list-success",
      }),
      "shopping-list/clear-completed",
    ));
    expect(noListClearSuccess.status).toBe(200);
    expectClearShoppingMutationData((await readJson(noListClearSuccess)).data, "bulk-clear-completed-no-list-success");
    await expect(db.shoppingList.count({ where: { authorId: noListUser.id } })).resolves.toBe(1);

    for (const [clientMutationId, requestId, operation, path, resourceId, payload, deleted] of [
      ["bulk-clear-completed-bad-payload", "req_clear_completed_bad_payload", "shopping-list.clear-completed", "shopping-list/clear-completed", checked.id, JSON.stringify({ nope: true }), true],
      ["bulk-clear-completed-malformed-payload", "req_clear_completed_malformed_payload", "shopping-list.clear-completed", "shopping-list/clear-completed", checked.id, "{", true],
      ["bulk-clear-completed-null-payload", "req_clear_completed_null_payload", "shopping-list.clear-completed", "shopping-list/clear-completed", checked.id, null, true],
      ["bulk-clear-all-missing-item", "req_clear_all_missing_item", "shopping-list.clear-all", "shopping-list/clear-all", "missing-shopping-item", JSON.stringify({ cleared: true }), true],
      ["bulk-clear-all-not-deleted", "req_clear_all_not_deleted", "shopping-list.clear-all", "shopping-list/clear-all", activeWithoutJournal.id, JSON.stringify({ cleared: true }), false],
    ] as const) {
      if (!deleted) {
        await db.shoppingListItem.update({ where: { id: activeWithoutJournal.id }, data: { deletedAt: null } });
      }
      const body = { clientMutationId };
      const reservation = await reserveShoppingMutation(db, fixture, path, operation, body);
      await db.apiMutationTombstone.create({
        data: {
          idempotencyKeyId: reservation.id,
          operation,
          resourceType: "shopping_list_item",
          resourceId,
          payload,
        },
      });
      const response = await action(routeArgs(
        mutationRequest("POST", path, fixture.credential.token, requestId, body),
        path,
      ));
      expect(response.status).toBe(409);
      expectErrorEnvelope(await readJson(response), requestId, "idempotency_in_progress", 409);
      if (!deleted) {
        await db.shoppingListItem.update({ where: { id: activeWithoutJournal.id }, data: { deletedAt: new Date() } });
      }
    }
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
