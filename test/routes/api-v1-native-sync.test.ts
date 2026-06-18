import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { resolveApiV1ScopeRequirement } from "~/lib/api-v1.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import {
  createIngredientName,
  createStepDescription,
  createStepTitle,
  createTestUser,
  getOrCreateIngredientRef,
  getOrCreateUnit,
} from "../utils";

type LocalDb = Awaited<ReturnType<typeof getLocalDb>>;

function routeArgs(request: Request, splat: string) {
  return { request, params: { "*": splat }, context: { cloudflare: { env: null } } } as any;
}

async function readJson(response: Response) {
  return await response.json() as any;
}

function nativeSyncCursor(value: unknown) {
  return `v1.${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
}

function expectPrivateEnvelopeHeaders(response: Response, requestId: string) {
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(response.headers.get("X-Request-Id")).toBe(requestId);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Pragma")).toBe("no-cache");
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type, X-Request-Id, X-Client-Mutation-Id");
  expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, PATCH, PUT, DELETE, OPTIONS");
  expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id, Retry-After");
}

function expectSuccessEnvelope(payload: any, requestId: string) {
  expect(Object.keys(payload).sort()).toEqual(["data", "ok", "requestId"]);
  expect(payload.ok).toBe(true);
  expect(payload.requestId).toBe(requestId);
  expect(payload.data).toBeDefined();
}

function expectErrorEnvelope(payload: any, requestId: string, code: string, status: number) {
  expect(Object.keys(payload).sort()).toEqual(["error", "ok", "requestId"]);
  expect(payload.ok).toBe(false);
  expect(payload.requestId).toBe(requestId);
  expect(payload.error).toMatchObject({ code, status, message: expect.any(String) });
}

function expectNativeSyncDataShape(data: Record<string, unknown>) {
  expect(Object.keys(data).sort()).toEqual(["entries", "freshness", "hasMore", "nextCursor"]);
  expect(Array.isArray(data.entries)).toBe(true);
  expect(typeof data.hasMore).toBe("boolean");
  expect(typeof data.nextCursor).toBe("string");
}

function expectFreshnessShape(freshness: Record<string, unknown>, accountId: string) {
  expect(Object.keys(freshness).sort()).toEqual([
    "accountId",
    "environment",
    "generatedAt",
    "lastValidatedAt",
    "schemaVersion",
    "sourceEndpoint",
  ]);
  expect(freshness).toMatchObject({
    accountId,
    environment: "local",
    schemaVersion: 1,
    sourceEndpoint: "/api/v1/me/sync",
    generatedAt: expect.any(String),
    lastValidatedAt: expect.any(String),
  });
  expect(new Date(freshness.generatedAt as string).toISOString()).toBe(freshness.generatedAt);
  expect(new Date(freshness.lastValidatedAt as string).toISOString()).toBe(freshness.lastValidatedAt);
}

function expectNativeSyncEntryShape(entry: Record<string, unknown>) {
  expect(Object.keys(entry).sort()).toEqual([
    "action",
    "kind",
    "payload",
    "resourceId",
    "tombstone",
    "updatedAt",
  ]);
  expect(["upsert", "delete"]).toContain(entry.action);
  expect(typeof entry.kind).toBe("string");
  expect(typeof entry.resourceId).toBe("string");
  expect(typeof entry.updatedAt).toBe("string");
  expect(new Date(entry.updatedAt as string).toISOString()).toBe(entry.updatedAt);
}

function expectNativeTombstoneShape(tombstone: Record<string, unknown>) {
  expect(Object.keys(tombstone).sort()).toEqual([
    "deletedAt",
    "parentResourceId",
    "resourceId",
    "resourceType",
    "title",
    "updatedAt",
  ]);
  expect(typeof tombstone.resourceType).toBe("string");
  expect(typeof tombstone.resourceId).toBe("string");
  expect(tombstone.parentResourceId === null || typeof tombstone.parentResourceId === "string").toBe(true);
  expect(tombstone.title === null || typeof tombstone.title === "string").toBe(true);
  expect(typeof tombstone.deletedAt).toBe("string");
  expect(typeof tombstone.updatedAt).toBe("string");
}

function syncRequest(path: string, token: string, requestId: string) {
  return new UndiciRequest(`http://localhost/api/v1/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Request-Id": requestId,
    },
  }) as unknown as Request;
}

async function createSyncUser(db: LocalDb, updatedAt = new Date("2026-06-01T00:00:00.000Z")) {
  const user = await db.user.create({
    data: {
      ...createTestUser(),
      photoUrl: `/photos/profiles/${faker.string.alphanumeric(10)}.jpg`,
      updatedAt,
    },
  });
  const reader = await createApiCredential(db, user.id, "Native sync reader", { scopes: ["kitchen:read"] });
  const writeOnly = await createApiCredential(db, user.id, "Native sync writer", { scopes: ["kitchen:write"] });
  return { user, reader, writeOnly };
}

async function createNativeSyncFixture(db: LocalDb, options: { tiedUpdatedAt?: Date } = {}) {
  const base = options.tiedUpdatedAt ?? new Date("2026-06-01T00:00:00.000Z");
  const at = (minutes: number) => options.tiedUpdatedAt ?? new Date(base.getTime() + minutes * 60_000);
  const { user, reader, writeOnly } = await createSyncUser(db, at(0));

  await db.notificationPreference.create({
    data: {
      userId: user.id,
      notifySpoonOnMyRecipe: false,
      notifyForkOfMyRecipe: true,
      notifyCookbookSaveOfMine: false,
      notifyFellowChefOriginCook: true,
      updatedAt: at(1),
    },
  });

  const recipe = await db.recipe.create({
    data: {
      title: `Native Sync Recipe ${faker.string.alphanumeric(8)}`,
      description: "A recipe that proves the native cache can rebuild recipe detail.",
      servings: "4",
      chefId: user.id,
      sourceUrl: "https://example.com/native-sync-recipe",
      createdAt: at(2),
      updatedAt: at(2),
    },
  });
  await db.recipeStep.create({
    data: {
      recipeId: recipe.id,
      stepNum: 1,
      stepTitle: createStepTitle(),
      description: createStepDescription(),
      duration: 10,
      updatedAt: at(2),
    },
  });
  const unit = await getOrCreateUnit(db, `native sync unit ${faker.string.alphanumeric(8)}`);
  const ingredientRef = await getOrCreateIngredientRef(db, createIngredientName());
  await db.ingredient.create({
    data: {
      recipeId: recipe.id,
      stepNum: 1,
      quantity: 2,
      unitId: unit.id,
      ingredientRefId: ingredientRef.id,
      updatedAt: at(2),
    },
  });

  const cookbook = await db.cookbook.create({
    data: {
      title: `Native Sync Cookbook ${faker.string.alphanumeric(8)}`,
      authorId: user.id,
      createdAt: at(3),
      updatedAt: at(3),
    },
  });
  await db.recipeInCookbook.create({
    data: {
      cookbookId: cookbook.id,
      recipeId: recipe.id,
      addedById: user.id,
      createdAt: at(3),
      updatedAt: at(3),
    },
  });

  const spoon = await db.recipeSpoon.create({
    data: {
      chefId: user.id,
      recipeId: recipe.id,
      cookedAt: at(4),
      note: "Cooked from native sync fixture.",
      nextTime: "Add more lemon",
      createdAt: at(4),
      updatedAt: at(4),
    },
  });

  const list = await db.shoppingList.create({
    data: {
      authorId: user.id,
      createdAt: at(5),
      updatedAt: at(5),
    },
  });
  const shoppingRef = await getOrCreateIngredientRef(db, `native sync shopping ${faker.string.alphanumeric(8)}`);
  const shoppingItem = await db.shoppingListItem.create({
    data: {
      shoppingListId: list.id,
      ingredientRefId: shoppingRef.id,
      unitId: unit.id,
      quantity: 3,
      checked: true,
      checkedAt: at(5),
      sortIndex: 7,
      categoryKey: "produce",
      iconKey: "carrot",
      updatedAt: at(5),
    },
  });

  return {
    user,
    reader,
    writeOnly,
    recipe,
    cookbook,
    spoon,
    list,
    shoppingItem,
    unit,
    ingredientRef,
    shoppingRef,
    updatedAt: { profile: at(0), preferences: at(1), recipe: at(2), cookbook: at(3), spoon: at(4), shoppingItem: at(5) },
  };
}

async function createDeletedSyncFixture(db: LocalDb) {
  const { user, reader } = await createSyncUser(db, new Date("2026-06-02T00:00:00.000Z"));
  await db.notificationPreference.create({
    data: {
      userId: user.id,
      updatedAt: new Date("2026-06-02T00:01:00.000Z"),
    },
  });

  const deletedRecipe = await db.recipe.create({
    data: {
      title: `Deleted Sync Recipe ${faker.string.alphanumeric(8)}`,
      chefId: user.id,
      deletedAt: new Date("2026-06-02T00:02:30.000Z"),
      createdAt: new Date("2026-06-02T00:02:00.000Z"),
      updatedAt: new Date("2026-06-02T00:02:30.000Z"),
    },
  });
  const deletedSpoon = await db.recipeSpoon.create({
    data: {
      chefId: user.id,
      recipeId: deletedRecipe.id,
      cookedAt: new Date("2026-06-02T00:03:00.000Z"),
      deletedAt: new Date("2026-06-02T00:03:30.000Z"),
      createdAt: new Date("2026-06-02T00:03:00.000Z"),
      updatedAt: new Date("2026-06-02T00:03:30.000Z"),
    },
  });
  const list = await db.shoppingList.create({
    data: { authorId: user.id, updatedAt: new Date("2026-06-02T00:04:00.000Z") },
  });
  const deletedRef = await getOrCreateIngredientRef(db, `deleted native sync item ${faker.string.alphanumeric(8)}`);
  const deletedShoppingItem = await db.shoppingListItem.create({
    data: {
      shoppingListId: list.id,
      ingredientRefId: deletedRef.id,
      quantity: 1,
      deletedAt: new Date("2026-06-02T00:04:30.000Z"),
      updatedAt: new Date("2026-06-02T00:04:30.000Z"),
    },
  });

  const deletedCookbookId = `cookbook_deleted_${faker.string.alphanumeric(12)}`;
  const idempotency = await db.apiIdempotencyKey.create({
    data: {
      userId: user.id,
      credentialId: reader.credential.id,
      clientKey: "native-sync-deleted-cookbook",
      key: `delete-cookbook-${faker.string.alphanumeric(8)}`,
      operation: "cookbooks.delete",
      requestHash: `hash-${faker.string.alphanumeric(16)}`,
      expiresAt: new Date("2026-06-09T00:00:00.000Z"),
      createdAt: new Date("2026-06-02T00:05:00.000Z"),
      updatedAt: new Date("2026-06-02T00:05:00.000Z"),
    },
  });
  const cookbookDeletedAt = "2026-06-02T00:05:30.000Z";
  const cookbookTombstone = await db.apiMutationTombstone.create({
    data: {
      idempotencyKeyId: idempotency.id,
      operation: "cookbooks.delete",
      resourceType: "cookbook",
      resourceId: deletedCookbookId,
      payload: JSON.stringify({ title: "Deleted Native Sync Cookbook", deletedAt: cookbookDeletedAt }),
      createdAt: new Date(cookbookDeletedAt),
    },
  });

  return { user, reader, deletedRecipe, deletedSpoon, deletedShoppingItem, cookbookTombstone, deletedCookbookId, cookbookDeletedAt };
}

describe("API v1 private native sync", () => {
  let db: LocalDb;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("declares the private current-chef sync scope and enforces auth before syncing", async () => {
    const fixture = await createNativeSyncFixture(db);

    expect(resolveApiV1ScopeRequirement("GET", "me/sync")).toEqual({
      auth: "bearer",
      scopes: ["kitchen:read"],
    });

    const missingAuth = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/me/sync", {
      headers: { "X-Request-Id": "req_native_sync_missing_auth" },
    }) as unknown as Request, "me/sync"));
    expect(missingAuth.status).toBe(401);
    expectPrivateEnvelopeHeaders(missingAuth, "req_native_sync_missing_auth");
    expectErrorEnvelope(await readJson(missingAuth), "req_native_sync_missing_auth", "authentication_required", 401);

    const missingScope = await loader(routeArgs(syncRequest("me/sync", fixture.writeOnly.token, "req_native_sync_missing_scope"), "me/sync"));
    expect(missingScope.status).toBe(403);
    expectPrivateEnvelopeHeaders(missingScope, "req_native_sync_missing_scope");
    expectErrorEnvelope(await readJson(missingScope), "req_native_sync_missing_scope", "insufficient_scope", 403);
  });

  it("returns freshness metadata and ordered upsert entries for the current product model", async () => {
    const fixture = await createNativeSyncFixture(db);

    const response = await loader(routeArgs(syncRequest("me/sync?limit=20", fixture.reader.token, "req_native_sync_full"), "me/sync"));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expectPrivateEnvelopeHeaders(response, "req_native_sync_full");
    expectSuccessEnvelope(payload, "req_native_sync_full");
    expectNativeSyncDataShape(payload.data);
    expectFreshnessShape(payload.data.freshness, fixture.user.id);
    expect(payload.data.hasMore).toBe(false);
    expect(payload.data.nextCursor).toMatch(/^v1\./);
    expect(payload.data.entries.map((entry: { kind: string }) => entry.kind)).toEqual([
      "profile",
      "notificationPreferences",
      "recipe",
      "cookbook",
      "spoon",
      "shoppingItem",
    ]);
    for (const entry of payload.data.entries) {
      expectNativeSyncEntryShape(entry);
      expect(entry.action).toBe("upsert");
      expect(entry.tombstone).toBeNull();
    }

    expect(payload.data.entries[0]).toMatchObject({
      kind: "profile",
      resourceId: fixture.user.id,
      updatedAt: fixture.updatedAt.profile.toISOString(),
      payload: {
        id: fixture.user.id,
        email: fixture.user.email,
        username: fixture.user.username,
        photoUrl: fixture.user.photoUrl,
        updatedAt: fixture.updatedAt.profile.toISOString(),
      },
    });
    expect(payload.data.entries[1]).toMatchObject({
      kind: "notificationPreferences",
      resourceId: fixture.user.id,
      payload: {
        userId: fixture.user.id,
        notifySpoonOnMyRecipe: false,
        notifyForkOfMyRecipe: true,
        notifyCookbookSaveOfMine: false,
        notifyFellowChefOriginCook: true,
        updatedAt: fixture.updatedAt.preferences.toISOString(),
      },
    });
    expect(payload.data.entries[2]).toMatchObject({
      kind: "recipe",
      resourceId: fixture.recipe.id,
      payload: {
        id: fixture.recipe.id,
        title: fixture.recipe.title,
        deletedAt: null,
        steps: [{
          stepNum: 1,
          ingredients: [{
            name: fixture.ingredientRef.name,
            quantity: 2,
            unit: fixture.unit.name,
          }],
        }],
      },
    });
    expect(payload.data.entries[3]).toMatchObject({
      kind: "cookbook",
      resourceId: fixture.cookbook.id,
      payload: {
        id: fixture.cookbook.id,
        title: fixture.cookbook.title,
        deletedAt: null,
        recipes: [{ id: fixture.recipe.id, title: fixture.recipe.title }],
      },
    });
    expect(payload.data.entries[4]).toMatchObject({
      kind: "spoon",
      resourceId: fixture.spoon.id,
      payload: {
        id: fixture.spoon.id,
        recipeId: fixture.recipe.id,
        note: "Cooked from native sync fixture.",
        deletedAt: null,
      },
    });
    expect(payload.data.entries[5]).toMatchObject({
      kind: "shoppingItem",
      resourceId: fixture.shoppingItem.id,
      payload: {
        id: fixture.shoppingItem.id,
        name: fixture.shoppingRef.name,
        quantity: 3,
        unit: fixture.unit.name,
        checked: true,
        deletedAt: null,
      },
    });
  });

  it("paginates by deterministic updatedAt, kind, and id ordering with opaque cursors", async () => {
    const fixture = await createNativeSyncFixture(db, { tiedUpdatedAt: new Date("2026-06-03T00:00:00.000Z") });

    const first = await loader(routeArgs(syncRequest("me/sync?limit=3", fixture.reader.token, "req_native_sync_page_1"), "me/sync"));
    const firstPayload = await readJson(first);

    expect(first.status).toBe(200);
    expectSuccessEnvelope(firstPayload, "req_native_sync_page_1");
    expectNativeSyncDataShape(firstPayload.data);
    expect(firstPayload.data.entries.map((entry: { kind: string }) => entry.kind)).toEqual([
      "profile",
      "notificationPreferences",
      "recipe",
    ]);
    expect(firstPayload.data.hasMore).toBe(true);
    expect(firstPayload.data.nextCursor).toMatch(/^v1\./);

    const second = await loader(routeArgs(syncRequest(
      `me/sync?limit=3&cursor=${encodeURIComponent(firstPayload.data.nextCursor)}`,
      fixture.reader.token,
      "req_native_sync_page_2",
    ), "me/sync"));
    const secondPayload = await readJson(second);

    expect(second.status).toBe(200);
    expectSuccessEnvelope(secondPayload, "req_native_sync_page_2");
    expectNativeSyncDataShape(secondPayload.data);
    expect(secondPayload.data.entries.map((entry: { kind: string }) => entry.kind)).toEqual([
      "cookbook",
      "spoon",
      "shoppingItem",
    ]);
    expect(secondPayload.data.hasMore).toBe(false);

    const empty = await loader(routeArgs(syncRequest(
      `me/sync?limit=3&cursor=${encodeURIComponent(secondPayload.data.nextCursor)}`,
      fixture.reader.token,
      "req_native_sync_page_3",
    ), "me/sync"));
    const emptyPayload = await readJson(empty);

    expect(empty.status).toBe(200);
    expectSuccessEnvelope(emptyPayload, "req_native_sync_page_3");
    expect(emptyPayload.data.entries).toEqual([]);
    expect(emptyPayload.data.hasMore).toBe(false);
    expect(emptyPayload.data.nextCursor).toBe(secondPayload.data.nextCursor);
  });

  it("returns delete tombstones for recipes, cookbooks, spoons, and shopping items without payload leaks", async () => {
    const fixture = await createDeletedSyncFixture(db);

    const response = await loader(routeArgs(syncRequest("me/sync?limit=20", fixture.reader.token, "req_native_sync_tombstones"), "me/sync"));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expectPrivateEnvelopeHeaders(response, "req_native_sync_tombstones");
    expectSuccessEnvelope(payload, "req_native_sync_tombstones");
    expectNativeSyncDataShape(payload.data);
    const deletes = payload.data.entries.filter((entry: { action: string }) => entry.action === "delete");
    expect(deletes.map((entry: { kind: string }) => entry.kind)).toEqual([
      "recipe",
      "spoon",
      "shoppingItem",
      "cookbook",
    ]);

    for (const entry of deletes) {
      expectNativeSyncEntryShape(entry);
      expect(entry.payload).toBeNull();
      expectNativeTombstoneShape(entry.tombstone);
    }

    expect(deletes[0]).toMatchObject({
      kind: "recipe",
      resourceId: fixture.deletedRecipe.id,
      tombstone: {
        resourceType: "recipe",
        resourceId: fixture.deletedRecipe.id,
        parentResourceId: null,
        title: fixture.deletedRecipe.title,
        deletedAt: fixture.deletedRecipe.deletedAt?.toISOString(),
        updatedAt: fixture.deletedRecipe.updatedAt.toISOString(),
      },
    });
    expect(deletes[1]).toMatchObject({
      kind: "spoon",
      resourceId: fixture.deletedSpoon.id,
      tombstone: {
        resourceType: "spoon",
        resourceId: fixture.deletedSpoon.id,
        parentResourceId: fixture.deletedRecipe.id,
        title: null,
        deletedAt: fixture.deletedSpoon.deletedAt?.toISOString(),
        updatedAt: fixture.deletedSpoon.updatedAt.toISOString(),
      },
    });
    expect(deletes[2]).toMatchObject({
      kind: "shoppingItem",
      resourceId: fixture.deletedShoppingItem.id,
      tombstone: {
        resourceType: "shoppingItem",
        resourceId: fixture.deletedShoppingItem.id,
        parentResourceId: fixture.deletedShoppingItem.shoppingListId,
        title: null,
        deletedAt: fixture.deletedShoppingItem.deletedAt?.toISOString(),
        updatedAt: fixture.deletedShoppingItem.updatedAt.toISOString(),
      },
    });
    expect(deletes[3]).toMatchObject({
      kind: "cookbook",
      resourceId: fixture.deletedCookbookId,
      tombstone: {
        resourceType: "cookbook",
        resourceId: fixture.deletedCookbookId,
        parentResourceId: null,
        title: "Deleted Native Sync Cookbook",
        deletedAt: fixture.cookbookDeletedAt,
        updatedAt: fixture.cookbookTombstone.createdAt.toISOString(),
      },
    });
  });

  it("validates cursor and page limits before returning native sync data", async () => {
    const fixture = await createNativeSyncFixture(db);
    const invalidCursors = [
      "not-a-date",
      "2026",
      "2026-06-01",
      "2026-06-01T00:00:00",
      "2026-06-01T00:00:00Z",
      "v1.%",
      nativeSyncCursor({}),
      nativeSyncCursor({ updatedAt: "not-a-date", kind: "recipe", resourceId: "recipe_1" }),
      nativeSyncCursor({ updatedAt: "2026-06-01T00:00:00.000Z", kind: 123, resourceId: "recipe_1" }),
      nativeSyncCursor({ updatedAt: "2026-06-01T00:00:00.000Z", kind: "recipe", resourceId: 123 }),
    ];

    for (const [index, cursor] of invalidCursors.entries()) {
      const requestId = `req_native_sync_invalid_cursor_${index}`;
      const response = await loader(routeArgs(syncRequest(
        `me/sync?cursor=${encodeURIComponent(cursor)}`,
        fixture.reader.token,
        requestId,
      ), "me/sync"));
      expect(response.status).toBe(400);
      expectPrivateEnvelopeHeaders(response, requestId);
      expectErrorEnvelope(await readJson(response), requestId, "invalid_cursor", 400);
    }

    for (const [index, limit] of ["0", "51", "abc"].entries()) {
      const requestId = `req_native_sync_invalid_limit_${index}`;
      const response = await loader(routeArgs(syncRequest(
        `me/sync?limit=${limit}`,
        fixture.reader.token,
        requestId,
      ), "me/sync"));
      expect(response.status).toBe(400);
      expectPrivateEnvelopeHeaders(response, requestId);
      expectErrorEnvelope(await readJson(response), requestId, "validation_error", 400);
    }
  });
});
