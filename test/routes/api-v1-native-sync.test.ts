import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { action, loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { createUser } from "~/lib/auth.server";
import { getLocalDb } from "~/lib/db.server";
import type { ImageGenRunner } from "~/lib/image-gen.server";
import { scheduleSpoonCoverStylization } from "~/lib/spoon-cover-stylization.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, getOrCreateIngredientRef, getOrCreateUnit } from "../utils";

const GENERATED_PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function dataUrl(contentType: string, bytes: Uint8Array) {
  return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function localImageRunner(): ImageGenRunner {
  return {
    textToImage: vi.fn().mockResolvedValue({ bytes: GENERATED_PNG_BYTES, contentType: "image/png" }),
    imageToImage: vi.fn().mockResolvedValue({ bytes: GENERATED_PNG_BYTES, contentType: "image/png" }),
  };
}

function mockR2(): R2Bucket {
  return {
    put: vi.fn(async () => ({})),
    delete: vi.fn(async () => undefined),
    get: vi.fn(),
    head: vi.fn(),
    list: vi.fn(),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
  } as unknown as R2Bucket;
}

function routeArgs(request: Request, splat = "me/sync", env: Record<string, unknown> = {}) {
  return {
    request,
    params: { "*": splat },
    context: {
      cloudflare: {
        env,
      },
    },
  } as any;
}

function syncRequest(token: string | null, requestId: string, query = "", origin = "http://localhost") {
  return new UndiciRequest(`${origin}/api/v1/me/sync${query}`, {
    headers: {
      "X-Request-Id": requestId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  }) as unknown as Request;
}

function jsonMutationRequest(token: string, requestId: string, splat: string, method: string, body: unknown) {
  return new UndiciRequest(`http://localhost/api/v1/${splat}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": requestId,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  }) as unknown as Request;
}

async function readJson(response: Response) {
  return await response.json() as any;
}

describe("API v1 native account sync", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await cleanupDatabase();
  });

  it("returns a private first-party native bootstrap feed for the signed-in chef", async () => {
    const user = await createUser(db, "NativeSync@Example.com", `native_sync_${faker.string.alphanumeric(8)}`, "correctHorseBatteryStaple");
    const other = await createUser(db, "other-sync@example.com", `other_sync_${faker.string.alphanumeric(8)}`, "correctHorseBatteryStaple");
    await db.user.update({
      where: { id: user.id },
      data: { photoUrl: "/photos/profiles/native-sync/avatar.jpg" },
    });
    const recipe = await db.recipe.create({
      data: {
        ...createTestRecipe(user.id),
        title: `Native Sync Recipe ${faker.string.alphanumeric(8)}`,
        updatedAt: new Date("2026-06-01T10:00:00.000Z"),
      },
    });
    await db.recipe.create({
      data: {
        ...createTestRecipe(other.id),
        title: `Other Native Sync Recipe ${faker.string.alphanumeric(8)}`,
      },
    });
    const cookbook = await db.cookbook.create({
      data: {
        title: `Native Sync Cookbook ${faker.string.alphanumeric(8)}`,
        authorId: user.id,
        updatedAt: new Date("2026-06-01T10:01:00.000Z"),
      },
    });
    await db.recipeInCookbook.create({
      data: { recipeId: recipe.id, cookbookId: cookbook.id, addedById: user.id },
    });
    const list = await db.shoppingList.create({ data: { authorId: user.id } });
    const activeIngredient = await getOrCreateIngredientRef(db, `native sync apple ${faker.string.alphanumeric(8)}`.toLowerCase());
    const deletedIngredient = await getOrCreateIngredientRef(db, `native sync flour ${faker.string.alphanumeric(8)}`.toLowerCase());
    const unit = await getOrCreateUnit(db, `native sync bag ${faker.string.alphanumeric(8)}`.toLowerCase());
    const activeItem = await db.shoppingListItem.create({
      data: {
        shoppingListId: list.id,
        ingredientRefId: activeIngredient.id,
        unitId: unit.id,
        quantity: 2,
        sortIndex: 1,
        updatedAt: new Date("2026-06-01T10:02:00.000Z"),
      },
    });
    const deletedItem = await db.shoppingListItem.create({
      data: {
        shoppingListId: list.id,
        ingredientRefId: deletedIngredient.id,
        quantity: 1,
        sortIndex: 2,
        deletedAt: new Date("2026-06-01T10:03:00.000Z"),
        updatedAt: new Date("2026-06-01T10:03:00.000Z"),
      },
    });
    const credential = await createApiCredential(db, user.id, "Native sync reader", {
      scopes: ["account:read", "kitchen:read"],
    });

    const response = await loader(routeArgs(syncRequest(credential.token, "req_native_sync"), "me/sync", {
      NODE_ENV: "production",
      SPOONJOY_BASE_URL: "https://spoonjoy.app",
    }));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(payload).toMatchObject({
      ok: true,
      requestId: "req_native_sync",
      data: {
        freshness: {
          accountId: user.id,
          environment: "production",
          schemaVersion: 1,
          sourceEndpoint: "/api/v1/me/sync",
        },
        hasMore: false,
      },
    });
    expect(payload.data.nextCursor).toMatch(/^v1\./);
    expect(payload.data.entries.map((entry: { kind: string }) => entry.kind)).toEqual(expect.arrayContaining([
      "profile",
      "recipe",
      "cookbook",
      "shoppingItem",
    ]));
    expect(payload.data.entries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceId: other.id }),
    ]));
    expect(payload.data.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "upsert",
        kind: "profile",
        resourceId: user.id,
        payload: expect.objectContaining({
          email: user.email,
          username: user.username,
          photoUrl: "https://spoonjoy.app/photos/profiles/native-sync/avatar.jpg",
          joinedLabel: "Joined Spoonjoy",
        }),
      }),
      expect.objectContaining({
        action: "upsert",
        kind: "recipe",
        resourceId: recipe.id,
        payload: expect.objectContaining({ title: recipe.title }),
      }),
      expect.objectContaining({
        action: "upsert",
        kind: "cookbook",
        resourceId: cookbook.id,
        payload: expect.objectContaining({ title: cookbook.title }),
      }),
      expect.objectContaining({
        action: "upsert",
        kind: "shoppingItem",
        resourceId: activeItem.id,
        payload: expect.objectContaining({ name: activeIngredient.name, unit: unit.name }),
      }),
      expect.objectContaining({
        action: "delete",
        kind: "shoppingItem",
        resourceId: deletedItem.id,
        tombstone: expect.objectContaining({
          resourceType: "shoppingItem",
          resourceId: deletedItem.id,
          parentResourceId: list.id,
          title: deletedIngredient.name,
          deletedAt: "2026-06-01T10:03:00.000Z",
        }),
      }),
    ]));
  });

  it("returns durable recipe and cookbook delete tombstones for native offline caches", async () => {
    const user = await createUser(db, "delete-sync@example.com", `delete_sync_${faker.string.alphanumeric(8)}`, "correctHorseBatteryStaple");
    const credential = await createApiCredential(db, user.id, "Native sync deleter", {
      scopes: ["account:read", "kitchen:read", "kitchen:write"],
    });
    const recipe = await db.recipe.create({
      data: {
        ...createTestRecipe(user.id),
        title: `Deleted Native Recipe ${faker.string.alphanumeric(8)}`,
        updatedAt: new Date("2026-06-01T12:00:00.000Z"),
      },
    });
    const cookbook = await db.cookbook.create({
      data: {
        title: `Deleted Native Cookbook ${faker.string.alphanumeric(8)}`,
        authorId: user.id,
        updatedAt: new Date("2026-06-01T12:01:00.000Z"),
      },
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-01T12:10:00.000Z"));
    const recipeDelete = await action(routeArgs(jsonMutationRequest(
      credential.token,
      "req_native_recipe_delete",
      `recipes/${recipe.id}`,
      "DELETE",
      { clientMutationId: `delete-recipe-${faker.string.uuid()}` },
    ), `recipes/${recipe.id}`));
    vi.setSystemTime(new Date("2026-06-01T12:11:00.000Z"));
    const cookbookDelete = await action(routeArgs(jsonMutationRequest(
      credential.token,
      "req_native_cookbook_delete",
      `cookbooks/${cookbook.id}`,
      "DELETE",
      { clientMutationId: `delete-cookbook-${faker.string.uuid()}` },
    ), `cookbooks/${cookbook.id}`));

    const sync = await loader(routeArgs(syncRequest(
      credential.token,
      "req_native_sync_deletes",
      "?cursor=2026-06-01T12%3A09%3A00.000Z",
    )));
    const payload = await readJson(sync);

    expect(recipeDelete.status).toBe(200);
    expect(cookbookDelete.status).toBe(200);
    expect(sync.status).toBe(200);
    expect(payload.data.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "delete",
        kind: "recipe",
        resourceId: recipe.id,
        tombstone: expect.objectContaining({
          resourceType: "recipe",
          resourceId: recipe.id,
          title: recipe.title,
          deletedAt: "2026-06-01T12:10:00.000Z",
        }),
      }),
      expect.objectContaining({
        action: "delete",
        kind: "cookbook",
        resourceId: cookbook.id,
        tombstone: expect.objectContaining({
          resourceType: "cookbook",
          resourceId: cookbook.id,
          title: cookbook.title,
          deletedAt: "2026-06-01T12:11:00.000Z",
        }),
      }),
    ]));
  });

  it("does not trust a loopback request host as local when worker config is production-shaped", async () => {
    const user = await createUser(db, "ipv6-sync@example.com", `ipv6_sync_${faker.string.alphanumeric(8)}`, "correctHorseBatteryStaple");
    const credential = await createApiCredential(db, user.id, "Native sync IPv6 reader", {
      scopes: ["account:read", "kitchen:read"],
    });

    const response = await loader(routeArgs(syncRequest(
      credential.token,
      "req_native_sync_ipv6",
      "",
      "http://[::1]",
    ), "me/sync", {
      NODE_ENV: "production",
      SPOONJOY_BASE_URL: "https://spoonjoy.app",
    }));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expect(payload.data.freshness.environment).toBe("production");
  });

  it("classifies native sync environments from explicit env, base URL, and preview fallback", async () => {
    const user = await createUser(db, "env-sync@example.com", `env_sync_${faker.string.alphanumeric(8)}`, "correctHorseBatteryStaple");
    const credential = await createApiCredential(db, user.id, "Native sync environment reader", {
      scopes: ["account:read", "kitchen:read"],
    });
    const cases = [
      {
        requestId: "req_native_sync_env_explicit",
        origin: "https://preview-worker.example",
        env: { SPOONJOY_NATIVE_ENVIRONMENT: "production" },
        expected: "production",
      },
	      {
	        requestId: "req_native_sync_env_local_base",
	        origin: "https://preview-worker.example",
	        env: { SPOONJOY_BASE_URL: "http://127.0.0.1:5173" },
	        expected: "local",
	      },
	      {
	        requestId: "req_native_sync_env_local_ipv6_request",
	        origin: "http://[::1]:5173",
	        env: {},
	        expected: "local",
	      },
	      {
	        requestId: "req_native_sync_env_local_flag",
	        origin: "http://app.localhost:5173",
        env: { SPOONJOY_BASE_URL: "https://spoonjoy.app", SPOONJOY_ALLOW_INSECURE_LOCAL_SESSIONS: "true" },
        expected: "local",
      },
      {
        requestId: "req_native_sync_env_production_base",
        origin: "https://preview-worker.example",
        env: { SPOONJOY_BASE_URL: "https://spoonjoy.app" },
        expected: "production",
      },
      {
        requestId: "req_native_sync_env_preview_base",
        origin: "https://preview-worker.example",
        env: { SPOONJOY_BASE_URL: "https://preview.spoonjoy.pages.dev" },
        expected: "preview",
      },
      {
        requestId: "req_native_sync_env_preview_request",
        origin: "https://preview-worker.example",
        env: {},
        expected: "preview",
      },
    ] as const;

    for (const item of cases) {
      const response = await loader(routeArgs(
        syncRequest(credential.token, item.requestId, "", item.origin),
        "me/sync",
        item.env,
      ));
      const payload = await readJson(response);

      expect(response.status).toBe(200);
      expect(payload.data.freshness.environment).toBe(item.expected);
    }
  });

  it("bumps cookbook sync revisions when recipe membership changes", async () => {
    const user = await createUser(db, "membership-sync@example.com", `membership_sync_${faker.string.alphanumeric(8)}`, "correctHorseBatteryStaple");
    const credential = await createApiCredential(db, user.id, "Native sync cookbook membership", {
      scopes: ["account:read", "kitchen:read", "kitchen:write"],
    });
    const recipe = await db.recipe.create({
      data: {
        ...createTestRecipe(user.id),
        title: `Membership Native Recipe ${faker.string.alphanumeric(8)}`,
        updatedAt: new Date("2026-06-01T13:00:00.000Z"),
      },
    });
    const cookbook = await db.cookbook.create({
      data: {
        title: `Membership Native Cookbook ${faker.string.alphanumeric(8)}`,
        authorId: user.id,
        updatedAt: new Date("2026-06-01T13:01:00.000Z"),
      },
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-01T13:10:00.000Z"));
    const add = await action(routeArgs(jsonMutationRequest(
      credential.token,
      "req_native_cookbook_member_add",
      `cookbooks/${cookbook.id}/recipes/${recipe.id}`,
      "POST",
      { clientMutationId: `add-recipe-${faker.string.uuid()}` },
    ), `cookbooks/${cookbook.id}/recipes/${recipe.id}`));
    const addPayload = await readJson(add);
    const syncAfterAdd = await loader(routeArgs(syncRequest(
      credential.token,
      "req_native_sync_membership_add",
      "?cursor=2026-06-01T13%3A09%3A59.000Z",
    )));
    const addSyncPayload = await readJson(syncAfterAdd);

    vi.setSystemTime(new Date("2026-06-01T13:11:00.000Z"));
    const remove = await action(routeArgs(jsonMutationRequest(
      credential.token,
      "req_native_cookbook_member_remove",
      `cookbooks/${cookbook.id}/recipes/${recipe.id}`,
      "DELETE",
      { clientMutationId: `remove-recipe-${faker.string.uuid()}` },
    ), `cookbooks/${cookbook.id}/recipes/${recipe.id}`));
    const syncAfterRemove = await loader(routeArgs(syncRequest(
      credential.token,
      "req_native_sync_membership_remove",
      `?cursor=${encodeURIComponent(addPayload.data.cookbook.updatedAt)}`,
    )));
    const removeSyncPayload = await readJson(syncAfterRemove);

    expect(add.status).toBe(201);
    expect(addPayload.data.cookbook.updatedAt).toBe("2026-06-01T13:10:00.000Z");
    expect(addSyncPayload.data.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "upsert",
        kind: "cookbook",
        resourceId: cookbook.id,
        updatedAt: "2026-06-01T13:10:00.000Z",
        payload: expect.objectContaining({
          recipeCount: 1,
          recipes: [expect.objectContaining({ id: recipe.id })],
        }),
      }),
    ]));
    expect(remove.status).toBe(200);
    expect(removeSyncPayload.data.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "upsert",
        kind: "cookbook",
        resourceId: cookbook.id,
        updatedAt: "2026-06-01T13:11:00.000Z",
        payload: expect.objectContaining({
          recipeCount: 0,
          recipes: [],
        }),
      }),
    ]));
  });

  it("bumps recipe sync revisions when nested step content changes", async () => {
    const user = await createUser(db, "nested-sync@example.com", `nested_sync_${faker.string.alphanumeric(8)}`, "correctHorseBatteryStaple");
    const credential = await createApiCredential(db, user.id, "Native sync nested recipe editor", {
      scopes: ["account:read", "kitchen:read", "kitchen:write"],
    });
    const recipe = await db.recipe.create({
      data: {
        ...createTestRecipe(user.id),
        title: `Nested Native Recipe ${faker.string.alphanumeric(8)}`,
        updatedAt: new Date("2026-06-01T13:20:00.000Z"),
      },
    });
    const step = await db.recipeStep.create({
      data: {
        recipeId: recipe.id,
        stepNum: 1,
        stepTitle: "Prep",
        description: "Old prep.",
        duration: null,
        updatedAt: new Date("2026-06-01T13:20:00.000Z"),
      },
    });
    const ingredientRef = await getOrCreateIngredientRef(db, `nested sync tomato ${faker.string.alphanumeric(8)}`.toLowerCase());
    const unit = await getOrCreateUnit(db, `nested sync cup ${faker.string.alphanumeric(8)}`.toLowerCase());
    await db.ingredient.create({
      data: {
        recipeId: recipe.id,
        stepNum: step.stepNum,
        quantity: 1,
        unitId: unit.id,
        ingredientRefId: ingredientRef.id,
        updatedAt: new Date("2026-06-01T13:20:00.000Z"),
      },
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-01T13:25:00.000Z"));
    const edit = await action(routeArgs(jsonMutationRequest(
      credential.token,
      "req_native_nested_step_edit",
      `recipes/${recipe.id}/steps/${step.id}`,
      "PATCH",
      {
        clientMutationId: `edit-step-${faker.string.uuid()}`,
        description: "New prep for offline cache.",
      },
    ), `recipes/${recipe.id}/steps/${step.id}`));
    const sync = await loader(routeArgs(syncRequest(
      credential.token,
      "req_native_sync_nested_step",
      "?cursor=2026-06-01T13%3A24%3A59.000Z",
    )));
    const payload = await readJson(sync);

    expect(edit.status).toBe(200);
    expect(sync.status).toBe(200);
    expect(payload.data.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "upsert",
        kind: "recipe",
        resourceId: recipe.id,
        updatedAt: "2026-06-01T13:25:00.000Z",
        payload: expect.objectContaining({
          steps: [expect.objectContaining({
            id: step.id,
            description: "New prep for offline cache.",
          })],
        }),
      }),
    ]));
  });

  it("bumps recipe and containing cookbook sync revisions when an active cover stylization changes", async () => {
    const user = await createUser(db, "cover-sync@example.com", `cover_sync_${faker.string.alphanumeric(8)}`, "correctHorseBatteryStaple");
    const credential = await createApiCredential(db, user.id, "Native sync cover refresh", {
      scopes: ["account:read", "kitchen:read"],
    });
    const oldRecipeUpdatedAt = new Date("2026-06-01T14:00:00.000Z");
    const oldCookbookUpdatedAt = new Date("2026-06-01T14:01:00.000Z");
    const recipe = await db.recipe.create({
      data: {
        ...createTestRecipe(user.id),
        title: `Cover Native Recipe ${faker.string.alphanumeric(8)}`,
        updatedAt: oldRecipeUpdatedAt,
      },
    });
    const activeCover = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/covers/native-sync-raw.jpg",
        stylizedImageUrl: "/photos/covers/native-sync-old-editorial.jpg",
        sourceType: "chef-upload",
        status: "ready",
        sourceImageUrl: "/photos/covers/native-sync-source.jpg",
        generationStatus: "succeeded",
        createdById: user.id,
      },
    });
    await db.recipe.update({
      where: { id: recipe.id },
      data: {
        activeCoverId: activeCover.id,
        activeCoverVariant: "stylized",
        coverMode: "manual",
        updatedAt: oldRecipeUpdatedAt,
      },
    });
    const cookbook = await db.cookbook.create({
      data: {
        title: `Cover Native Cookbook ${faker.string.alphanumeric(8)}`,
        authorId: user.id,
        updatedAt: oldCookbookUpdatedAt,
      },
    });
    await db.recipeInCookbook.create({
      data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: user.id },
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-01T14:10:00.000Z"));
    await scheduleSpoonCoverStylization({
      db: await getLocalDb(),
      userId: user.id,
      recipeId: recipe.id,
      coverId: activeCover.id,
      rawPhotoUrl: dataUrl("image/png", GENERATED_PNG_BYTES),
      recipeTitle: recipe.title,
      runner: localImageRunner(),
      bucket: mockR2(),
      now: () => Date.parse("2026-06-01T14:10:00.000Z"),
      suppressAutoActivation: true,
      logger: { error: vi.fn() },
    });
    const expectedCoverUrl = /^https:\/\/spoonjoy\.app\/photos\/covers\/1780323000000-[a-f0-9-]+\.png$/;

    const response = await loader(routeArgs(syncRequest(
      credential.token,
      "req_native_sync_cover_refresh",
      "?cursor=2026-06-01T14%3A05%3A00.000Z",
    )));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expect(payload.data.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "upsert",
        kind: "recipe",
        resourceId: recipe.id,
        updatedAt: "2026-06-01T14:10:00.000Z",
        payload: expect.objectContaining({
          coverImageUrl: expect.stringMatching(expectedCoverUrl),
          coverVariant: "stylized",
        }),
      }),
      expect.objectContaining({
        action: "upsert",
        kind: "cookbook",
        resourceId: cookbook.id,
        updatedAt: "2026-06-01T14:10:00.000Z",
        payload: expect.objectContaining({
          coverImageUrls: [expect.stringMatching(expectedCoverUrl)],
          recipes: [expect.objectContaining({
            id: recipe.id,
            coverImageUrl: expect.stringMatching(expectedCoverUrl),
          })],
        }),
      }),
    ]));
  });

  it("supports opaque cursor paging for native sync bootstrap", async () => {
    const user = await createUser(db, "cursor-sync@example.com", `cursor_sync_${faker.string.alphanumeric(8)}`, "correctHorseBatteryStaple");
    const credential = await createApiCredential(db, user.id, "Native sync cursor reader", {
      scopes: ["account:read", "kitchen:read"],
    });
    const list = await db.shoppingList.create({ data: { authorId: user.id } });
    for (const [index, name] of ["one", "two", "three"].entries()) {
      const ingredient = await getOrCreateIngredientRef(db, `native sync ${name} ${faker.string.alphanumeric(8)}`.toLowerCase());
      await db.shoppingListItem.create({
        data: {
          shoppingListId: list.id,
          ingredientRefId: ingredient.id,
          quantity: index + 1,
          sortIndex: index,
          updatedAt: new Date(`2026-06-01T11:0${index}:00.000Z`),
        },
      });
    }

    const first = await loader(routeArgs(syncRequest(credential.token, "req_native_sync_page_1", "?limit=2")));
    const firstPayload = await readJson(first);
    const second = await loader(routeArgs(syncRequest(
      credential.token,
      "req_native_sync_page_2",
      `?limit=2&cursor=${encodeURIComponent(firstPayload.data.nextCursor)}`,
    )));
    const secondPayload = await readJson(second);

    expect(first.status).toBe(200);
    expect(firstPayload.data.entries).toHaveLength(2);
    expect(firstPayload.data.hasMore).toBe(true);
    expect(second.status).toBe(200);
    expect(secondPayload.data.entries.map((entry: { resourceId: string }) => entry.resourceId))
      .not.toContain(firstPayload.data.entries[0].resourceId);
    expect(secondPayload.data.hasMore).toBe(false);
  });

  it("sorts same-kind same-timestamp entries deterministically and skips unsupported future tombstones", async () => {
    const user = await createUser(db, "tie-sync@example.com", `tie_sync_${faker.string.alphanumeric(8)}`, "correctHorseBatteryStaple");
    const credential = await createApiCredential(db, user.id, "Native sync tie reader", {
      scopes: ["account:read", "kitchen:read"],
    });
    const list = await db.shoppingList.create({ data: { authorId: user.id } });
    const unit = await getOrCreateUnit(db, `native sync tie unit ${faker.string.alphanumeric(8)}`.toLowerCase());
    const ingredientA = await getOrCreateIngredientRef(db, `native sync tie apple ${faker.string.alphanumeric(8)}`.toLowerCase());
    const ingredientB = await getOrCreateIngredientRef(db, `native sync tie berry ${faker.string.alphanumeric(8)}`.toLowerCase());
    const sameUpdatedAt = new Date("2026-06-01T15:00:00.000Z");
    const recipe = await db.recipe.create({
      data: {
        ...createTestRecipe(user.id),
        title: `Native Sync Tie Recipe ${faker.string.alphanumeric(8)}`,
        updatedAt: sameUpdatedAt,
      },
    });
    const cookbook = await db.cookbook.create({
      data: {
        title: `Native Sync Tie Cookbook ${faker.string.alphanumeric(8)}`,
        authorId: user.id,
        updatedAt: sameUpdatedAt,
      },
    });
    const first = await db.shoppingListItem.create({
      data: {
        shoppingListId: list.id,
        ingredientRefId: ingredientA.id,
        unitId: unit.id,
        quantity: 1,
        sortIndex: 0,
        updatedAt: sameUpdatedAt,
      },
    });
    const second = await db.shoppingListItem.create({
      data: {
        shoppingListId: list.id,
        ingredientRefId: ingredientB.id,
        unitId: unit.id,
        quantity: 2,
        sortIndex: 1,
        updatedAt: sameUpdatedAt,
      },
    });
    await db.nativeSyncTombstone.create({
      data: {
        accountId: user.id,
        resourceType: "futureResource",
        resourceId: "future_resource_1",
        title: "Future unsupported resource",
        deletedAt: sameUpdatedAt,
        updatedAt: sameUpdatedAt,
      },
    });

    const response = await loader(routeArgs(syncRequest(credential.token, "req_native_sync_ties")));
    const payload = await readJson(response);
    const shoppingIds = payload.data.entries
      .filter((entry: { kind: string }) => entry.kind === "shoppingItem")
      .map((entry: { resourceId: string }) => entry.resourceId);

    expect(response.status).toBe(200);
    expect(shoppingIds).toEqual([first.id, second.id].sort());
    expect(payload.data.entries
      .filter((entry: { updatedAt: string }) => entry.updatedAt === sameUpdatedAt.toISOString())
      .map((entry: { kind: string; resourceId: string }) => `${entry.kind}:${entry.resourceId}`))
      .toEqual([
        `cookbook:${cookbook.id}`,
        `recipe:${recipe.id}`,
        ...[first.id, second.id].sort().map((id) => `shoppingItem:${id}`),
      ]);
    expect(payload.data.entries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceId: "future_resource_1" }),
    ]));
  });

  it("omits recipe and cookbook refs that disappear during hydration and preserves empty-page cursors", async () => {
    const user = await createUser(db, "disappearing-cookbook-sync@example.com", `disappearing_sync_${faker.string.alphanumeric(8)}`, "correctHorseBatteryStaple");
    const credential = await createApiCredential(db, user.id, "Native sync disappearing cookbook reader", {
      scopes: ["account:read", "kitchen:read"],
    });
    const recipe = await db.recipe.create({
      data: {
        ...createTestRecipe(user.id),
        title: `Disappearing Native Recipe ${faker.string.alphanumeric(8)}`,
        updatedAt: new Date("2026-06-01T15:59:00.000Z"),
      },
    });
    const cookbook = await db.cookbook.create({
      data: {
        title: `Disappearing Native Cookbook ${faker.string.alphanumeric(8)}`,
        authorId: user.id,
        updatedAt: new Date("2026-06-01T16:00:00.000Z"),
      },
    });
    const localDb = await getLocalDb();
    const originalRecipeFindFirst = localDb.recipe.findFirst;
    const originalFindUnique = localDb.cookbook.findUnique;
    let forcedMissingRecipe = false;
    let forcedMissingCookbook = false;
    localDb.recipe.findFirst = vi.fn((args: Parameters<typeof localDb.recipe.findFirst>[0]) => {
      if (args?.where?.id === recipe.id) {
        forcedMissingRecipe = true;
        return Promise.resolve(null);
      }
      return originalRecipeFindFirst.call(localDb.recipe, args);
    }) as typeof localDb.recipe.findFirst;
    localDb.cookbook.findUnique = vi.fn((args: Parameters<typeof localDb.cookbook.findUnique>[0]) => {
      if (args?.where?.id === cookbook.id) {
        forcedMissingCookbook = true;
        return Promise.resolve(null);
      }
      return originalFindUnique.call(localDb.cookbook, args);
    }) as typeof localDb.cookbook.findUnique;
    let cursor: string;
    try {
      const response = await loader(routeArgs(syncRequest(credential.token, "req_native_sync_disappearing_cookbook")));
      const payload = await readJson(response);

      expect(response.status).toBe(200);
      expect(forcedMissingRecipe).toBe(true);
      expect(forcedMissingCookbook).toBe(true);
      expect(payload.data.entries).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "recipe", resourceId: recipe.id }),
        expect.objectContaining({ kind: "cookbook", resourceId: cookbook.id }),
      ]));
      cursor = payload.data.nextCursor;
    } finally {
      localDb.recipe.findFirst = originalRecipeFindFirst;
      localDb.cookbook.findUnique = originalFindUnique;
    }

    const emptyPage = await loader(routeArgs(syncRequest(
      credential.token,
      "req_native_sync_empty_page",
      `?cursor=${encodeURIComponent(cursor!)}`,
    )));
    const emptyPayload = await readJson(emptyPage);

    expect(emptyPage.status).toBe(200);
    expect(emptyPayload.data.entries).toEqual([]);
    expect(emptyPayload.data.nextCursor).toBe(cursor!);
  });

  it("enforces account and kitchen read scopes before serving private sync data", async () => {
    const user = await createUser(db, "scope-sync@example.com", `scope_sync_${faker.string.alphanumeric(8)}`, "correctHorseBatteryStaple");
    const accountOnly = await createApiCredential(db, user.id, "Native sync account only", { scopes: ["account:read"] });
    const kitchenOnly = await createApiCredential(db, user.id, "Native sync kitchen only", { scopes: ["kitchen:read"] });

    const missing = await loader(routeArgs(syncRequest(null, "req_native_sync_missing")));
    const accountOnlyResponse = await loader(routeArgs(syncRequest(accountOnly.token, "req_native_sync_account_only")));
    const kitchenOnlyResponse = await loader(routeArgs(syncRequest(kitchenOnly.token, "req_native_sync_kitchen_only")));

    expect(missing.status).toBe(401);
    expect(await readJson(missing)).toMatchObject({
      error: { code: "authentication_required" },
    });
    expect(accountOnlyResponse.status).toBe(403);
    expect(await readJson(accountOnlyResponse)).toMatchObject({
      error: { code: "insufficient_scope", message: "Missing required scope: kitchen:read" },
    });
    expect(kitchenOnlyResponse.status).toBe(403);
    expect(await readJson(kitchenOnlyResponse)).toMatchObject({
      error: { code: "insufficient_scope", message: "Missing required scope: account:read" },
    });
  });

  it("rejects invalid native sync cursors", async () => {
    const user = await createUser(db, "bad-cursor-sync@example.com", `bad_cursor_sync_${faker.string.alphanumeric(8)}`, "correctHorseBatteryStaple");
    const credential = await createApiCredential(db, user.id, "Native sync cursor validator", {
      scopes: ["account:read", "kitchen:read"],
    });

    const response = await loader(routeArgs(syncRequest(credential.token, "req_native_sync_bad_cursor", "?cursor=bad")));
    const payload = await readJson(response);

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      error: { code: "invalid_cursor" },
    });
  });
});
