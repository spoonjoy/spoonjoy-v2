import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { action, loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { loadNativeSyncSnapshot } from "~/lib/api-v1-native-sync.server";
import { resolveApiV1ScopeRequirement } from "~/lib/api-v1.server";
import { getLocalDb } from "~/lib/db.server";
import { createCover } from "~/lib/recipe-cover.server";
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

function routeArgs(request: Request, splat: string, env: Record<string, unknown> | null = null) {
  return { request, params: { "*": splat }, context: { cloudflare: { env } } } as any;
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

function deleteRequest(path: string, token: string, requestId: string, clientMutationId: string) {
  return new UndiciRequest(`http://localhost/api/v1/${path}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Request-Id": requestId,
      "X-Client-Mutation-Id": clientMutationId,
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
  const sourceOwner = await db.user.create({
    data: {
      ...createTestUser(),
      photoUrl: `/photos/profiles/source_${faker.string.alphanumeric(10)}.jpg`,
      updatedAt: at(0),
    },
  });

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

  const sourceRecipe = await db.recipe.create({
    data: {
      title: `Native Sync Source Recipe ${faker.string.alphanumeric(8)}`,
      description: "Original public source recipe.",
      chefId: sourceOwner.id,
      createdAt: at(1),
      updatedAt: at(1),
    },
  });
  const createdRecipe = await db.recipe.create({
    data: {
      title: `Native Sync Recipe ${faker.string.alphanumeric(8)}`,
      description: "A recipe that proves the native cache can rebuild recipe detail.",
      servings: "4",
      chefId: user.id,
      sourceRecipeId: sourceRecipe.id,
      sourceUrl: "https://example.com/native-sync-recipe",
      createdAt: at(2),
      updatedAt: at(2),
    },
  });
  const createdCover = await createCover(db, {
    recipeId: createdRecipe.id,
    imageUrl: "/photos/recipes/native-sync-original.jpg",
    stylizedImageUrl: "/photos/recipes/native-sync-stylized.jpg",
    sourceType: "chef-upload",
  });
  const cover = await db.recipeCover.update({
    where: { id: createdCover.id },
    data: { createdAt: at(2) },
  });
  const recipe = await db.recipe.update({
    where: { id: createdRecipe.id },
    data: {
      activeCoverId: cover.id,
      activeCoverVariant: "stylized",
      coverMode: "manual",
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
    sourceOwner,
    sourceRecipe,
    cover,
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
  const cookbookDeletedAt = "2026-06-02T00:05:30.000Z";
  const cookbookTombstone = await db.nativeSyncTombstone.create({
    data: {
      userId: user.id,
      resourceType: "cookbook",
      resourceId: deletedCookbookId,
      title: "Deleted Native Sync Cookbook",
      deletedAt: new Date(cookbookDeletedAt),
      updatedAt: new Date(cookbookDeletedAt),
      createdAt: new Date(cookbookDeletedAt),
    },
  });

  return { user, reader, deletedRecipe, deletedSpoon, deletedShoppingItem, cookbookTombstone, deletedCookbookId, cookbookDeletedAt };
}

async function createNativeSyncGraphFixture(db: LocalDb) {
  const { user, reader } = await createSyncUser(db, new Date("2026-06-04T00:00:00.000Z"));
  const recipeUpdatedAt = new Date("2026-06-04T00:02:00.000Z");
  const unit = await getOrCreateUnit(db, `native graph unit ${faker.string.alphanumeric(8)}`);
  const appleRef = await getOrCreateIngredientRef(db, `apple native graph ${faker.string.alphanumeric(8)}`);
  const zucchiniRef = await getOrCreateIngredientRef(db, `zucchini native graph ${faker.string.alphanumeric(8)}`);
  const firstRecipe = await db.recipe.create({
    data: {
      id: `recipe_sync_a_${faker.string.alphanumeric(8)}`,
      title: `A Native Graph Recipe ${faker.string.alphanumeric(8)}`,
      chefId: user.id,
      createdAt: recipeUpdatedAt,
      updatedAt: recipeUpdatedAt,
    },
  });
  const secondRecipe = await db.recipe.create({
    data: {
      id: `recipe_sync_b_${faker.string.alphanumeric(8)}`,
      title: `B Native Graph Recipe ${faker.string.alphanumeric(8)}`,
      chefId: user.id,
      createdAt: recipeUpdatedAt,
      updatedAt: recipeUpdatedAt,
    },
  });
  await db.recipeStep.createMany({
    data: [
      { recipeId: firstRecipe.id, stepNum: 1, stepTitle: "Prep", description: "Prep ingredients.", duration: 5, updatedAt: recipeUpdatedAt },
      { recipeId: firstRecipe.id, stepNum: 2, stepTitle: "Cook", description: "Cook aromatics.", duration: 8, updatedAt: recipeUpdatedAt },
      { recipeId: firstRecipe.id, stepNum: 3, stepTitle: "Finish", description: "Finish the plate.", duration: 2, updatedAt: recipeUpdatedAt },
    ],
  });
  await db.ingredient.createMany({
    data: [
      { recipeId: firstRecipe.id, stepNum: 1, quantity: 1, unitId: unit.id, ingredientRefId: zucchiniRef.id, updatedAt: recipeUpdatedAt },
      { recipeId: firstRecipe.id, stepNum: 1, quantity: 2, unitId: unit.id, ingredientRefId: appleRef.id, updatedAt: recipeUpdatedAt },
    ],
  });
  await db.stepOutputUse.createMany({
    data: [
      { recipeId: firstRecipe.id, outputStepNum: 2, inputStepNum: 3, updatedAt: recipeUpdatedAt },
      { recipeId: firstRecipe.id, outputStepNum: 1, inputStepNum: 3, updatedAt: recipeUpdatedAt },
    ],
  });

  return { user, reader, firstRecipe, secondRecipe, appleRef, zucchiniRef, recipeUpdatedAt };
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
      "cookbook",
      "recipe",
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
    const recipeEntry = payload.data.entries.find((entry: { resourceId: string }) => entry.resourceId === fixture.recipe.id);
    const cookbookEntry = payload.data.entries.find((entry: { resourceId: string }) => entry.resourceId === fixture.cookbook.id);
    expect(recipeEntry).toMatchObject({
      kind: "recipe",
      resourceId: fixture.recipe.id,
      payload: {
        id: fixture.recipe.id,
        title: fixture.recipe.title,
        chef: {
          id: fixture.user.id,
          username: fixture.user.username,
        },
        coverImageUrl: "https://spoonjoy.app/photos/recipes/native-sync-stylized.jpg",
        coverProvenanceLabel: expect.any(String),
        coverSourceType: "chef-upload",
        coverVariant: "stylized",
        href: `/recipes/${fixture.recipe.id}`,
        canonicalUrl: `https://spoonjoy.app/recipes/${fixture.recipe.id}`,
        attribution: {
          creditText: `${fixture.recipe.title} by ${fixture.user.username} on Spoonjoy`,
          canonicalUrl: `https://spoonjoy.app/recipes/${fixture.recipe.id}`,
          sourceUrl: "https://example.com/native-sync-recipe",
          sourceHost: "example.com",
          sourceRecipe: {
            id: fixture.sourceRecipe.id,
            title: fixture.sourceRecipe.title,
            chef: {
              id: fixture.sourceOwner.id,
              username: fixture.sourceOwner.username,
            },
            href: `/recipes/${fixture.sourceRecipe.id}`,
            canonicalUrl: `https://spoonjoy.app/recipes/${fixture.sourceRecipe.id}`,
            deleted: false,
          },
        },
        deletedAt: null,
        steps: [{
          stepNum: 1,
          ingredients: [{
            name: fixture.ingredientRef.name,
            quantity: 2,
            unit: fixture.unit.name,
          }],
        }],
        cookbooks: [{
          id: fixture.cookbook.id,
          title: fixture.cookbook.title,
          href: `/cookbooks/${fixture.cookbook.id}`,
          canonicalUrl: `https://spoonjoy.app/cookbooks/${fixture.cookbook.id}`,
        }],
        recentSpoons: [{
          id: fixture.spoon.id,
          recipeId: fixture.recipe.id,
          note: "Cooked from native sync fixture.",
          deletedAt: null,
          chef: {
            id: fixture.user.id,
            username: fixture.user.username,
            photoUrl: fixture.user.photoUrl,
          },
        }],
      },
    });
    expect(cookbookEntry).toMatchObject({
      kind: "cookbook",
      resourceId: fixture.cookbook.id,
      payload: {
        id: fixture.cookbook.id,
        title: fixture.cookbook.title,
        chef: {
          id: fixture.user.id,
          username: fixture.user.username,
        },
        recipeCount: 1,
        coverImageUrls: ["https://spoonjoy.app/photos/recipes/native-sync-stylized.jpg"],
        href: `/cookbooks/${fixture.cookbook.id}`,
        canonicalUrl: `https://spoonjoy.app/cookbooks/${fixture.cookbook.id}`,
        attribution: {
          creditText: `${fixture.cookbook.title} by ${fixture.user.username} on Spoonjoy`,
          canonicalUrl: `https://spoonjoy.app/cookbooks/${fixture.cookbook.id}`,
        },
        deletedAt: null,
        recipes: [{
          id: fixture.recipe.id,
          title: fixture.recipe.title,
          coverImageUrl: "https://spoonjoy.app/photos/recipes/native-sync-stylized.jpg",
          href: `/recipes/${fixture.recipe.id}`,
          canonicalUrl: `https://spoonjoy.app/recipes/${fixture.recipe.id}`,
          attribution: {
            canonicalUrl: `https://spoonjoy.app/recipes/${fixture.recipe.id}`,
            sourceHost: "example.com",
          },
        }],
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

  it("derives freshness environment and public URLs from the route context", async () => {
    const fixture = await createNativeSyncFixture(db);

    const response = await loader(routeArgs(
      syncRequest("me/sync?limit=20", fixture.reader.token, "req_native_sync_env"),
      "me/sync",
      { SPOONJOY_ENV: "preview", SPOONJOY_BASE_URL: "https://preview.spoonjoy.app" },
    ));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expectSuccessEnvelope(payload, "req_native_sync_env");
    expect(payload.data.freshness).toMatchObject({
      accountId: fixture.user.id,
      environment: "preview",
    });
    const recipeEntry = payload.data.entries.find((entry: { kind: string }) => entry.kind === "recipe");
    const cookbookEntry = payload.data.entries.find((entry: { kind: string }) => entry.kind === "cookbook");
    expect(recipeEntry.payload).toMatchObject({
      canonicalUrl: `https://preview.spoonjoy.app/recipes/${fixture.recipe.id}`,
      coverImageUrl: "https://preview.spoonjoy.app/photos/recipes/native-sync-stylized.jpg",
    });
    expect(cookbookEntry.payload).toMatchObject({
      canonicalUrl: `https://preview.spoonjoy.app/cookbooks/${fixture.cookbook.id}`,
      coverImageUrls: ["https://preview.spoonjoy.app/photos/recipes/native-sync-stylized.jpg"],
    });
  });

  it("drops malformed public cover URLs and source hosts from native sync payloads", async () => {
    const fixture = await createNativeSyncFixture(db);
    await db.recipeCover.update({
      where: { id: fixture.cover.id },
      data: { stylizedImageUrl: "data:image/png;base64,abc123" },
    });
    const dataUrlCover = await loader(routeArgs(syncRequest("me/sync?limit=20", fixture.reader.token, "req_native_sync_data_url_cover"), "me/sync"));
    const dataUrlCoverPayload = await readJson(dataUrlCover);
    const dataUrlRecipeEntry = dataUrlCoverPayload.data.entries.find((entry: { resourceId: string }) => entry.resourceId === fixture.recipe.id);
    expect(dataUrlRecipeEntry.payload).toMatchObject({
      coverImageUrl: null,
      coverProvenanceLabel: null,
      coverSourceType: null,
      coverVariant: null,
    });

    await db.recipeCover.update({
      where: { id: fixture.cover.id },
      data: { stylizedImageUrl: "https://[broken-cover-url" },
    });
    await db.recipe.update({
      where: { id: fixture.recipe.id },
      data: { sourceUrl: "https://[broken-source-url" },
    });

    const response = await loader(routeArgs(syncRequest("me/sync?limit=20", fixture.reader.token, "req_native_sync_malformed_urls"), "me/sync"));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expectSuccessEnvelope(payload, "req_native_sync_malformed_urls");
    const recipeEntry = payload.data.entries.find((entry: { resourceId: string }) => entry.resourceId === fixture.recipe.id);
    const cookbookEntry = payload.data.entries.find((entry: { resourceId: string }) => entry.resourceId === fixture.cookbook.id);
    expect(recipeEntry.payload).toMatchObject({
      coverImageUrl: null,
      coverProvenanceLabel: null,
      coverSourceType: null,
      coverVariant: null,
      attribution: {
        sourceUrl: "https://[broken-source-url",
        sourceHost: null,
      },
    });
    expect(cookbookEntry.payload).toMatchObject({ coverImageUrls: [] });

    await db.recipe.update({
      where: { id: fixture.recipe.id },
      data: { sourceUrl: "file:///tmp/native-sync-source" },
    });
    const fileSource = await loader(routeArgs(syncRequest("me/sync?limit=20", fixture.reader.token, "req_native_sync_file_source"), "me/sync"));
    const fileSourcePayload = await readJson(fileSource);
    const fileSourceRecipeEntry = fileSourcePayload.data.entries.find((entry: { resourceId: string }) => entry.resourceId === fixture.recipe.id);
    expect(fileSourceRecipeEntry.payload.attribution).toMatchObject({
      sourceUrl: "file:///tmp/native-sync-source",
      sourceHost: null,
    });
  });

  it("keeps deleted source recipe attribution private-safe in native sync payloads", async () => {
    const fixture = await createNativeSyncFixture(db);
    await db.recipe.update({
      where: { id: fixture.sourceRecipe.id },
      data: {
        deletedAt: new Date("2026-06-01T00:07:00.000Z"),
        updatedAt: new Date("2026-06-01T00:07:00.000Z"),
      },
    });

    const response = await loader(routeArgs(syncRequest("me/sync?limit=20", fixture.reader.token, "req_native_sync_deleted_source"), "me/sync"));
    const payload = await readJson(response);
    const recipeEntry = payload.data.entries.find((entry: { resourceId: string }) => entry.resourceId === fixture.recipe.id);
    expect(recipeEntry.payload.attribution.sourceRecipe).toEqual({
      id: fixture.sourceRecipe.id,
      title: null,
      chef: null,
      href: null,
      canonicalUrl: null,
      deleted: true,
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

  it("keeps hard-deleted cookbook sync tombstones after idempotency cleanup", async () => {
    const fixture = await createNativeSyncFixture(db);
    const deleteCookbook = await db.cookbook.create({
      data: {
        title: `Native durable tombstone ${faker.string.alphanumeric(8)}`,
        authorId: fixture.user.id,
      },
    });

    const deleted = await action(routeArgs(
      deleteRequest(`cookbooks/${deleteCookbook.id}`, fixture.writeOnly.token, "req_native_sync_durable_delete", "native-sync-durable-delete"),
      `cookbooks/${deleteCookbook.id}`,
    ));
    const deletedPayload = await readJson(deleted);
    expect(deleted.status).toBe(200);
    expectSuccessEnvelope(deletedPayload, "req_native_sync_durable_delete");

    await db.apiIdempotencyKey.deleteMany({ where: { userId: fixture.user.id } });
    expect(await db.apiMutationTombstone.count()).toBe(0);

    const response = await loader(routeArgs(syncRequest("me/sync?limit=20", fixture.reader.token, "req_native_sync_durable_tombstone"), "me/sync"));
    const payload = await readJson(response);
    expect(response.status).toBe(200);
    const deletedEntry = payload.data.entries.find((entry: { resourceId: string }) => entry.resourceId === deleteCookbook.id);
    expect(deletedEntry).toMatchObject({
      action: "delete",
      kind: "cookbook",
      payload: null,
      tombstone: {
        resourceType: "cookbook",
        resourceId: deleteCookbook.id,
        title: deleteCookbook.title,
        parentResourceId: null,
        deletedAt: deletedPayload.data.cookbook.deletedAt,
        updatedAt: deletedPayload.data.cookbook.deletedAt,
      },
    });
  });

  it("uses recipe children and cookbook membership changes as incremental sync revisions", async () => {
    const fixture = await createNativeSyncFixture(db);
    const recipeParentCursor = nativeSyncCursor({
      updatedAt: fixture.updatedAt.recipe.toISOString(),
      kind: "recipe",
      resourceId: fixture.recipe.id,
    });
    const childUpdatedAt = new Date("2026-06-01T00:12:00.000Z");
    await db.recipeStep.update({
      where: { recipeId_stepNum: { recipeId: fixture.recipe.id, stepNum: 1 } },
      data: { description: "Changed child step after parent cursor.", updatedAt: childUpdatedAt },
    });

    const afterChild = await loader(routeArgs(syncRequest(
      `me/sync?cursor=${encodeURIComponent(recipeParentCursor)}`,
      fixture.reader.token,
      "req_native_sync_after_child",
    ), "me/sync"));
    const afterChildPayload = await readJson(afterChild);
    expect(afterChild.status).toBe(200);
    const recipeAfterChild = afterChildPayload.data.entries.find((entry: { resourceId: string }) => entry.resourceId === fixture.recipe.id);
    expect(recipeAfterChild).toMatchObject({
      kind: "recipe",
      updatedAt: childUpdatedAt.toISOString(),
      payload: {
        steps: [expect.objectContaining({ description: "Changed child step after parent cursor." })],
      },
    });

    const membershipCursor = nativeSyncCursor({
      updatedAt: childUpdatedAt.toISOString(),
      kind: "cookbook",
      resourceId: fixture.cookbook.id,
    });
    const removed = await action(routeArgs(
      deleteRequest(
        `cookbooks/${fixture.cookbook.id}/recipes/${fixture.recipe.id}`,
        fixture.writeOnly.token,
        "req_native_sync_remove_membership",
        "native-sync-remove-membership",
      ),
      `cookbooks/${fixture.cookbook.id}/recipes/${fixture.recipe.id}`,
    ));
    expect(removed.status).toBe(200);

    const afterMembership = await loader(routeArgs(syncRequest(
      `me/sync?cursor=${encodeURIComponent(membershipCursor)}`,
      fixture.reader.token,
      "req_native_sync_after_membership",
    ), "me/sync"));
    const afterMembershipPayload = await readJson(afterMembership);
    expect(afterMembership.status).toBe(200);
    const recipeAfterMembership = afterMembershipPayload.data.entries.find((entry: { resourceId: string }) => entry.resourceId === fixture.recipe.id);
    const cookbookAfterMembership = afterMembershipPayload.data.entries.find((entry: { resourceId: string }) => entry.resourceId === fixture.cookbook.id);
    expect(new Date(recipeAfterMembership.updatedAt).getTime()).toBeGreaterThan(childUpdatedAt.getTime());
    expect(new Date(cookbookAfterMembership.updatedAt).getTime()).toBeGreaterThan(childUpdatedAt.getTime());
    expect(recipeAfterMembership.payload.cookbooks).toEqual([]);
    expect(cookbookAfterMembership.payload).toMatchObject({
      recipes: [],
      recipeCount: 0,
      coverImageUrls: [],
    });
  });

  it("refreshes parent recipe previews when a recent spoon is deleted after the recipe cursor", async () => {
    const fixture = await createNativeSyncFixture(db);
    const recipeCursorAfterInitialPreview = nativeSyncCursor({
      updatedAt: fixture.updatedAt.spoon.toISOString(),
      kind: "recipe",
      resourceId: fixture.recipe.id,
    });

    const deleted = await action(routeArgs(
      deleteRequest(
        `recipes/${fixture.recipe.id}/spoons/${fixture.spoon.id}`,
        fixture.writeOnly.token,
        "req_native_sync_delete_recent_spoon",
        "native-sync-delete-recent-spoon",
      ),
      `recipes/${fixture.recipe.id}/spoons/${fixture.spoon.id}`,
    ));
    expect(deleted.status).toBe(200);

    const afterDelete = await loader(routeArgs(syncRequest(
      `me/sync?cursor=${encodeURIComponent(recipeCursorAfterInitialPreview)}&limit=20`,
      fixture.reader.token,
      "req_native_sync_after_recent_spoon_delete",
    ), "me/sync"));
    const afterDeletePayload = await readJson(afterDelete);
    expect(afterDelete.status).toBe(200);
    expectSuccessEnvelope(afterDeletePayload, "req_native_sync_after_recent_spoon_delete");

    const recipeEntry = afterDeletePayload.data.entries.find((entry: { kind: string; resourceId: string }) => (
      entry.kind === "recipe" && entry.resourceId === fixture.recipe.id
    ));
    const spoonEntry = afterDeletePayload.data.entries.find((entry: { kind: string; resourceId: string }) => (
      entry.kind === "spoon" && entry.resourceId === fixture.spoon.id
    ));
    expect(recipeEntry).toMatchObject({
      action: "upsert",
      kind: "recipe",
      resourceId: fixture.recipe.id,
      payload: { recentSpoons: [] },
      tombstone: null,
    });
    expect(new Date(recipeEntry.updatedAt).getTime()).toBeGreaterThan(fixture.updatedAt.spoon.getTime());
    expect(spoonEntry).toMatchObject({
      action: "delete",
      kind: "spoon",
      resourceId: fixture.spoon.id,
      payload: null,
      tombstone: {
        resourceType: "spoon",
        resourceId: fixture.spoon.id,
        parentResourceId: fixture.recipe.id,
      },
    });
  });

  it("handles default preferences, empty private domains, blank limits, ISO cursors, and helper not-found results", async () => {
    const { user, reader } = await createSyncUser(db, new Date("2026-06-05T00:00:00.000Z"));

    const blankParams = await loader(routeArgs(syncRequest(
      "me/sync?limit=&cursor=%20%20",
      reader.token,
      "req_native_sync_blank_params",
    ), "me/sync"));
    const blankPayload = await readJson(blankParams);

    expect(blankParams.status).toBe(200);
    expectSuccessEnvelope(blankPayload, "req_native_sync_blank_params");
    expectNativeSyncDataShape(blankPayload.data);
    expect(blankPayload.data.entries.map((entry: { kind: string }) => entry.kind)).toEqual([
      "profile",
      "notificationPreferences",
    ]);
    expect(blankPayload.data.entries[1]).toMatchObject({
      action: "upsert",
      kind: "notificationPreferences",
      resourceId: user.id,
      updatedAt: user.updatedAt.toISOString(),
      payload: {
        userId: user.id,
        notifySpoonOnMyRecipe: true,
        notifyForkOfMyRecipe: true,
        notifyCookbookSaveOfMine: true,
        notifyFellowChefOriginCook: true,
        updatedAt: user.updatedAt.toISOString(),
      },
      tombstone: null,
    });

    const isoCursor = await loader(routeArgs(syncRequest(
      `me/sync?cursor=${encodeURIComponent(new Date(user.updatedAt.getTime() - 1_000).toISOString())}`,
      reader.token,
      "req_native_sync_iso_cursor",
    ), "me/sync"));
    const isoPayload = await readJson(isoCursor);
    expect(isoCursor.status).toBe(200);
    expectSuccessEnvelope(isoPayload, "req_native_sync_iso_cursor");
    expect(isoPayload.data.entries.map((entry: { kind: string }) => entry.kind)).toEqual([
      "profile",
      "notificationPreferences",
    ]);

    const futureIsoCursor = user.updatedAt.toISOString();
    const empty = await loader(routeArgs(syncRequest(
      `me/sync?cursor=${encodeURIComponent(futureIsoCursor)}`,
      reader.token,
      "req_native_sync_iso_empty",
    ), "me/sync"));
    const emptyPayload = await readJson(empty);
    expect(empty.status).toBe(200);
    expectSuccessEnvelope(emptyPayload, "req_native_sync_iso_empty");
    expect(emptyPayload.data.entries).toEqual([]);
    expect(emptyPayload.data.nextCursor).toBe(futureIsoCursor);

    await expect(loadNativeSyncSnapshot(db, "missing-user", new URL("http://localhost/api/v1/me/sync")))
      .resolves.toMatchObject({ ok: false, code: "not_found" });
    await expect(loadNativeSyncSnapshot(db, user.id, new URL("http://localhost/api/v1/me/sync")))
      .resolves.toMatchObject({
        ok: true,
        data: { freshness: { accountId: user.id, environment: "local" } },
      });
    await expect(loadNativeSyncSnapshot(db, user.id, new URL("http://localhost/api/v1/me/sync"), { environment: "qa" }))
      .resolves.toMatchObject({
        ok: true,
        data: { freshness: { accountId: user.id, environment: "qa" } },
      });
  });

  it("sorts recipe subgraphs, same-kind resources, optional shopping fields, and malformed cookbook tombstones", async () => {
    const fixture = await createNativeSyncGraphFixture(db);
    const list = await db.shoppingList.create({
      data: {
        authorId: fixture.user.id,
        createdAt: new Date("2026-06-04T00:03:00.000Z"),
        updatedAt: new Date("2026-06-04T00:03:00.000Z"),
      },
    });
    const shoppingRef = await getOrCreateIngredientRef(db, `optional native sync item ${faker.string.alphanumeric(8)}`);
    const optionalShoppingItem = await db.shoppingListItem.create({
      data: {
        shoppingListId: list.id,
        ingredientRefId: shoppingRef.id,
        quantity: null,
        unitId: null,
        checked: false,
        checkedAt: null,
        sortIndex: 0,
        updatedAt: new Date("2026-06-04T00:03:00.000Z"),
      },
    });
    const tombstones = await Promise.all([
      db.nativeSyncTombstone.create({
        data: {
          userId: fixture.user.id,
          resourceType: "cookbook",
          resourceId: `cookbook_sync_tombstone_a_${faker.string.alphanumeric(8)}`,
          title: null,
          deletedAt: new Date("2026-06-04T00:04:00.000Z"),
          updatedAt: new Date("2026-06-04T00:04:00.000Z"),
          createdAt: new Date("2026-06-04T00:04:00.000Z"),
        },
      }),
      db.nativeSyncTombstone.create({
        data: {
          userId: fixture.user.id,
          resourceType: "cookbook",
          resourceId: `cookbook_sync_tombstone_b_${faker.string.alphanumeric(8)}`,
          title: "Deleted graph cookbook",
          deletedAt: new Date("2026-06-04T00:04:30.000Z"),
          updatedAt: new Date("2026-06-04T00:05:00.000Z"),
          createdAt: new Date("2026-06-04T00:05:00.000Z"),
        },
      }),
    ]);

    const response = await loader(routeArgs(syncRequest("me/sync?limit=20", fixture.reader.token, "req_native_sync_graph"), "me/sync"));
    const payload = await readJson(response);
    expect(response.status).toBe(200);
    expectSuccessEnvelope(payload, "req_native_sync_graph");
    const firstRecipeEntry = payload.data.entries.find((entry: { resourceId: string }) => entry.resourceId === fixture.firstRecipe.id);
    expect(firstRecipeEntry.payload.steps.map((step: { stepNum: number }) => step.stepNum)).toEqual([1, 2, 3]);
    expect(firstRecipeEntry.payload.steps[0].ingredients.map((ingredient: { name: string }) => ingredient.name)).toEqual([
      fixture.appleRef.name,
      fixture.zucchiniRef.name,
    ]);
    expect(firstRecipeEntry.payload.steps[2].usingSteps.map((use: { outputStepNum: number }) => use.outputStepNum)).toEqual([1, 2]);
    const recipeEntries = payload.data.entries.filter((entry: { kind: string }) => entry.kind === "recipe");
    expect(recipeEntries.map((entry: { resourceId: string }) => entry.resourceId)).toEqual([
      fixture.firstRecipe.id,
      fixture.secondRecipe.id,
    ]);
    const optionalShoppingEntry = payload.data.entries.find((entry: { resourceId: string }) => entry.resourceId === optionalShoppingItem.id);
    expect(optionalShoppingEntry).toMatchObject({
      payload: {
        id: optionalShoppingItem.id,
        shoppingListId: list.id,
        name: shoppingRef.name,
        quantity: null,
        unit: null,
        checkedAt: null,
      },
    });
    for (const tombstone of tombstones) {
      const entry = payload.data.entries.find((candidate: { resourceId: string }) => candidate.resourceId === tombstone.resourceId);
      expect(entry).toMatchObject({
        action: "delete",
        kind: "cookbook",
        payload: null,
        tombstone: {
          resourceType: "cookbook",
          resourceId: tombstone.resourceId,
          title: tombstone.title,
          deletedAt: tombstone.deletedAt.toISOString(),
          updatedAt: tombstone.updatedAt.toISOString(),
        },
      });
    }

    const afterFirstRecipe = await loader(routeArgs(syncRequest(
      `me/sync?cursor=${encodeURIComponent(nativeSyncCursor({
        updatedAt: fixture.recipeUpdatedAt.toISOString(),
        kind: "recipe",
        resourceId: fixture.firstRecipe.id,
      }))}`,
      fixture.reader.token,
      "req_native_sync_after_first_recipe",
    ), "me/sync"));
    const afterFirstRecipePayload = await readJson(afterFirstRecipe);
    expect(afterFirstRecipe.status).toBe(200);
    expect(afterFirstRecipePayload.data.entries[0]).toMatchObject({
      kind: "recipe",
      resourceId: fixture.secondRecipe.id,
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
      "2026-02-30T00:00:00.000Z",
      "v1.%",
      nativeSyncCursor(null),
      nativeSyncCursor([]),
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
