import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { action, loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { mapSpoonDomainErrorForApiV1 } from "~/lib/api-v1.server";
import { getLocalDb } from "~/lib/db.server";
import { SpoonAuthError, SpoonNotFoundError, SpoonValidationError } from "~/lib/recipe-spoon.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../utils";

function routeArgs(request: Request, splat: string, context = { cloudflare: { env: null } }) {
  return { request, params: { "*": splat }, context } as any;
}

function backgroundContext() {
  return {
    cloudflare: {
      env: null,
      ctx: {
        waitUntil: (promise: Promise<unknown>) => {
          void promise.catch(() => undefined);
        },
      },
    },
  };
}

async function readJson(response: Response) {
  return await response.json() as any;
}

function bearer(token: string, requestId: string, extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${token}`, "X-Request-Id": requestId, ...extra };
}

function jsonRequest(url: string, method: string, token: string, requestId: string, body: Record<string, unknown>) {
  return new UndiciRequest(url, {
    method,
    headers: bearer(token, requestId, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  }) as unknown as Request;
}

function spoonCursor(spoon: { cookedAt: Date; id: string }) {
  return `v1.${Buffer.from(JSON.stringify({ cookedAt: spoon.cookedAt.toISOString(), id: spoon.id }), "utf8").toString("base64url")}`;
}

async function createSpoonFixture(db: Awaited<ReturnType<typeof getLocalDb>>) {
  const owner = await db.user.create({ data: createTestUser() });
  const outsider = await db.user.create({ data: createTestUser() });
  const recipe = await db.recipe.create({
    data: {
      ...createTestRecipe(owner.id),
      title: `API v1 spoon ${faker.string.alphanumeric(8)}`,
    },
  });
  const otherRecipe = await db.recipe.create({
    data: {
      ...createTestRecipe(owner.id),
      title: `API v1 spoon other ${faker.string.alphanumeric(8)}`,
    },
  });
  const ownerKitchenWrite = await createApiCredential(db, owner.id, "Spoon owner write", { scopes: ["kitchen:write"] });
  const ownerRecipesRead = await createApiCredential(db, owner.id, "Spoon owner read", { scopes: ["recipes:read"] });
  const ownerPublicRead = await createApiCredential(db, owner.id, "Spoon owner public", { scopes: ["public:read"] });
  const ownerNoScopes = await createApiCredential(db, owner.id, "Spoon owner no scopes", { scopes: [] });
  const outsiderKitchenWrite = await createApiCredential(db, outsider.id, "Spoon outsider write", { scopes: ["kitchen:write"] });
  return {
    owner,
    outsider,
    recipe,
    otherRecipe,
    ownerKitchenWrite,
    ownerRecipesRead,
    ownerPublicRead,
    ownerNoScopes,
    outsiderKitchenWrite,
  };
}

describe("API v1 recipe spoon domain error mapping", () => {
  it("maps spoon service errors to API v1 errors and rethrows unknown failures", () => {
    expect(mapSpoonDomainErrorForApiV1(new SpoonValidationError("Bad spoon"))).toMatchObject({
      code: "validation_error",
      status: 400,
      message: "Bad spoon",
    });
    expect(mapSpoonDomainErrorForApiV1(new SpoonAuthError("No spoon"), "spoon_1")).toMatchObject({
      code: "insufficient_scope",
      status: 403,
      message: "No spoon",
    });
    expect(mapSpoonDomainErrorForApiV1(new SpoonNotFoundError("gone"), "spoon_2")).toMatchObject({
      code: "not_found",
      status: 404,
      details: { resource: "recipe_spoon", spoonId: "spoon_2" },
    });

    const unknown = new Error("database exploded");
    expect(() => mapSpoonDomainErrorForApiV1(unknown)).toThrow(unknown);
  });
});

describe("API v1 recipe spoons", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("lists recent non-deleted spoons publicly with cookedAt/id cursor pagination", async () => {
    const fixture = await createSpoonFixture(db);
    const suffix = faker.string.alphanumeric(8);
    const older = await db.recipeSpoon.create({
      data: {
        id: `spoon_api_older_${suffix}`,
        chefId: fixture.outsider.id,
        recipeId: fixture.recipe.id,
        cookedAt: new Date("2026-01-01T00:00:00.000Z"),
        photoUrl: "data:image/png;base64,AAAA",
        note: "Hidden data photo",
        nextTime: "More lemon",
      },
      include: { chef: { select: { id: true, username: true, photoUrl: true } } },
    });
    const tieLow = await db.recipeSpoon.create({
      data: {
        id: `spoon_api_tie_a_${suffix}`,
        chefId: fixture.owner.id,
        recipeId: fixture.recipe.id,
        cookedAt: new Date("2026-01-02T00:00:00.000Z"),
        photoUrl: `/photos/spoons/${fixture.owner.id}/${fixture.recipe.id}/tie-a.jpg`,
        note: "Tie low",
      },
    });
    const tieHigh = await db.recipeSpoon.create({
      data: {
        id: `spoon_api_tie_z_${suffix}`,
        chefId: fixture.owner.id,
        recipeId: fixture.recipe.id,
        cookedAt: new Date("2026-01-02T00:00:00.000Z"),
        photoUrl: `/photos/spoons/${fixture.owner.id}/${fixture.recipe.id}/tie-z.jpg`,
        note: "Tie high",
      },
    });
    await db.recipeSpoon.create({
      data: {
        id: `spoon_api_deleted_${suffix}`,
        chefId: fixture.owner.id,
        recipeId: fixture.recipe.id,
        cookedAt: new Date("2026-01-03T00:00:00.000Z"),
        note: "Deleted",
        deletedAt: new Date("2026-01-04T00:00:00.000Z"),
      },
    });

    const firstPage = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons?limit=2`, {
      headers: { "X-Request-Id": "req_spoons_list_page_1" },
    }) as unknown as Request, `recipes/${fixture.recipe.id}/spoons`));
    const firstPayload = await readJson(firstPage);

    expect(firstPage.status).toBe(200);
    expect(firstPage.headers.get("Cache-Control")).toBe("public, max-age=60, stale-while-revalidate=300");
    expect(firstPayload).toMatchObject({
      ok: true,
      requestId: "req_spoons_list_page_1",
      data: {
        limit: 2,
        cursor: null,
        hasMore: true,
        spoons: [
          expect.objectContaining({
            id: tieHigh.id,
            chefId: fixture.owner.id,
            recipeId: fixture.recipe.id,
            photoUrl: `https://spoonjoy.app/photos/spoons/${fixture.owner.id}/${fixture.recipe.id}/tie-z.jpg`,
            note: "Tie high",
            deletedAt: null,
            chef: expect.objectContaining({ id: fixture.owner.id, username: fixture.owner.username }),
          }),
          expect.objectContaining({ id: tieLow.id }),
        ],
      },
    });
    expect(firstPayload.data.nextCursor).toBe(spoonCursor(tieLow));

    const secondPage = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons?limit=2&cursor=${encodeURIComponent(firstPayload.data.nextCursor)}`, {
      headers: bearer(fixture.ownerRecipesRead.token, "req_spoons_list_page_2"),
    }) as unknown as Request, `recipes/${fixture.recipe.id}/spoons`));
    const secondPayload = await readJson(secondPage);

    expect(secondPage.status).toBe(200);
    expect(secondPage.headers.get("Cache-Control")).toBe("private, no-store");
    expect(secondPayload).toMatchObject({
      ok: true,
      requestId: "req_spoons_list_page_2",
      data: {
        cursor: firstPayload.data.nextCursor,
        nextCursor: null,
        hasMore: false,
        spoons: [
          expect.objectContaining({
            id: older.id,
            photoUrl: null,
            nextTime: "More lemon",
            chef: older.chef,
          }),
        ],
      },
    });

    for (const [token, requestId, expectedStatus] of [
      [fixture.ownerPublicRead.token, "req_spoons_public_read", 200],
      [fixture.ownerNoScopes.token, "req_spoons_no_scope", 403],
    ] as const) {
      const response = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons`, {
        headers: bearer(token, requestId),
      }) as unknown as Request, `recipes/${fixture.recipe.id}/spoons`));
      expect(response.status).toBe(expectedStatus);
    }

    const invalidCursor = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons?cursor=bad`, {
      headers: { "X-Request-Id": "req_spoons_invalid_cursor" },
    }) as unknown as Request, `recipes/${fixture.recipe.id}/spoons`));
    expect(invalidCursor.status).toBe(400);
    await expect(invalidCursor.json()).resolves.toMatchObject({
      ok: false,
      requestId: "req_spoons_invalid_cursor",
      error: { code: "invalid_cursor", status: 400 },
    });

    const wrongShapeCursor = `v1.${Buffer.from(JSON.stringify({ createdAt: "2026-01-02T00:00:00.000Z", id: tieLow.id }), "utf8").toString("base64url")}`;
    const wrongShape = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons?cursor=${wrongShapeCursor}`, {
      headers: { "X-Request-Id": "req_spoons_wrong_shape_cursor" },
    }) as unknown as Request, `recipes/${fixture.recipe.id}/spoons`));
    expect(wrongShape.status).toBe(400);
    await expect(wrongShape.json()).resolves.toMatchObject({
      ok: false,
      requestId: "req_spoons_wrong_shape_cursor",
      error: { code: "invalid_cursor", status: 400 },
    });

    const wrongMethod = await action(routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons`, {
      method: "PUT",
      headers: { "X-Request-Id": "req_spoons_wrong_method" },
    }) as unknown as Request, `recipes/${fixture.recipe.id}/spoons`));
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("Allow")).toBe("GET, POST");

    const missingRecipe = await loader(routeArgs(new UndiciRequest("http://localhost/api/v1/recipes/missing_recipe/spoons", {
      headers: { "X-Request-Id": "req_spoons_missing_recipe" },
    }) as unknown as Request, "recipes/missing_recipe/spoons"));
    expect(missingRecipe.status).toBe(404);
  });

  it("creates spoons idempotently and applies cover activation rules for owner spoon photos", async () => {
    const fixture = await createSpoonFixture(db);
    const existingCover = await db.recipeCover.create({
      data: {
        recipeId: fixture.recipe.id,
        imageUrl: "/photos/covers/existing.jpg",
        sourceType: "chef-upload",
        status: "ready",
        createdById: fixture.owner.id,
      },
    });
    await db.recipe.update({
      where: { id: fixture.recipe.id },
      data: {
        activeCoverId: existingCover.id,
        activeCoverVariant: "image",
        coverMode: "manual",
      },
    });

    const missingAuth = await action(routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons`, {
      method: "POST",
      headers: { "X-Request-Id": "req_spoon_create_missing_auth", "Content-Type": "application/json" },
      body: JSON.stringify({ clientMutationId: "spoon-create-missing", note: "No auth" }),
    }) as unknown as Request, `recipes/${fixture.recipe.id}/spoons`));
    expect(missingAuth.status).toBe(401);

    const wrongScope = await action(routeArgs(jsonRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons`, "POST", fixture.ownerRecipesRead.token, "req_spoon_create_wrong_scope", {
      clientMutationId: "spoon-create-wrong-scope",
      note: "Wrong scope",
    }), `recipes/${fixture.recipe.id}/spoons`));
    expect(wrongScope.status).toBe(403);

    const body = {
      clientMutationId: "spoon-create-manual-cover",
      note: "  Dinner notes  ",
      nextTime: "Add herbs",
      cookedAt: "2026-02-01T12:30:00.000Z",
      photoUrl: `/photos/spoons/${fixture.owner.id}/${fixture.recipe.id}/manual-cover.jpg`,
      useAsRecipeCover: true,
    };
    const response = await action(routeArgs(jsonRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons`, "POST", fixture.ownerKitchenWrite.token, "req_spoon_create", body), `recipes/${fixture.recipe.id}/spoons`, backgroundContext()));
    const payload = await readJson(response);
    const recipe = await db.recipe.findUniqueOrThrow({ where: { id: fixture.recipe.id } });

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({
      ok: true,
      requestId: "req_spoon_create",
      data: {
        spoon: expect.objectContaining({
          chefId: fixture.owner.id,
          recipeId: fixture.recipe.id,
          cookedAt: "2026-02-01T12:30:00.000Z",
          photoUrl: `https://spoonjoy.app/photos/spoons/${fixture.owner.id}/${fixture.recipe.id}/manual-cover.jpg`,
          note: "Dinner notes",
          nextTime: "Add herbs",
          deletedAt: null,
          chef: expect.objectContaining({ id: fixture.owner.id, username: fixture.owner.username }),
        }),
        isOriginCook: true,
        createdCover: expect.objectContaining({
          sourceType: "spoon",
          sourceImageUrl: `https://spoonjoy.app/photos/spoons/${fixture.owner.id}/${fixture.recipe.id}/manual-cover.jpg`,
          activeVariant: "image",
        }),
        activeCover: expect.objectContaining({ activeVariant: "image" }),
        mutation: { clientMutationId: "spoon-create-manual-cover", replayed: false },
      },
    });
    expect(recipe).toMatchObject({
      activeCoverId: payload.data.createdCover.id,
      activeCoverVariant: "image",
      coverMode: "manual",
    });

    const replay = await action(routeArgs(jsonRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons`, "POST", fixture.ownerKitchenWrite.token, "req_spoon_create_replay", body), `recipes/${fixture.recipe.id}/spoons`, backgroundContext()));
    expect(replay.status).toBe(201);
    await expect(replay.json()).resolves.toMatchObject({
      ok: true,
      requestId: "req_spoon_create_replay",
      data: {
        spoon: { id: payload.data.spoon.id },
        mutation: { clientMutationId: "spoon-create-manual-cover", replayed: true },
      },
    });

    const conflict = await action(routeArgs(jsonRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons`, "POST", fixture.ownerKitchenWrite.token, "req_spoon_create_conflict", {
      ...body,
      note: "Different body",
    }), `recipes/${fixture.recipe.id}/spoons`, backgroundContext()));
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      ok: false,
      requestId: "req_spoon_create_conflict",
      error: { code: "idempotency_conflict", status: 409 },
    });

    const invalidCookedAt = await action(routeArgs(jsonRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons`, "POST", fixture.ownerKitchenWrite.token, "req_spoon_create_invalid_date", {
      clientMutationId: "spoon-create-invalid-date",
      note: "Bad date",
      cookedAt: "not-a-date",
    }), `recipes/${fixture.recipe.id}/spoons`));
    expect(invalidCookedAt.status).toBe(400);
  });

  it("auto-seeds an origin-cook spoon photo cover when auto mode has no real cover", async () => {
    const fixture = await createSpoonFixture(db);
    const body = {
      clientMutationId: "spoon-create-auto-cover",
      photoUrl: `/photos/spoons/${fixture.owner.id}/${fixture.recipe.id}/auto-cover.jpg`,
    };

    const response = await action(routeArgs(jsonRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons`, "POST", fixture.ownerKitchenWrite.token, "req_spoon_create_auto_cover", body), `recipes/${fixture.recipe.id}/spoons`, backgroundContext()));
    const payload = await readJson(response);
    const recipe = await db.recipe.findUniqueOrThrow({ where: { id: fixture.recipe.id } });

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({
      ok: true,
      data: {
        isOriginCook: true,
        createdCover: expect.objectContaining({
          sourceType: "spoon",
          activeVariant: null,
        }),
      },
    });
    expect(recipe).toMatchObject({
      activeCoverId: payload.data.createdCover.id,
      activeCoverVariant: null,
      coverMode: "auto",
    });
  });

  it("updates spoons idempotently with owner-only recipe-path validation", async () => {
    const fixture = await createSpoonFixture(db);
    const spoon = await db.recipeSpoon.create({
      data: {
        chefId: fixture.owner.id,
        recipeId: fixture.recipe.id,
        photoUrl: `/photos/spoons/${fixture.owner.id}/${fixture.recipe.id}/before.jpg`,
        note: "Before",
      },
    });
    const url = `http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons/${spoon.id}`;
    const splat = `recipes/${fixture.recipe.id}/spoons/${spoon.id}`;
    const body = {
      clientMutationId: "spoon-update",
      note: "After",
      nextTime: "Less salt",
      cookedAt: "2026-03-01T00:00:00.000Z",
      photoUrl: `/photos/spoons/${fixture.owner.id}/${fixture.recipe.id}/after.jpg`,
    };

    const response = await action(routeArgs(jsonRequest(url, "PATCH", fixture.ownerKitchenWrite.token, "req_spoon_update", body), splat));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      requestId: "req_spoon_update",
      data: {
        spoon: expect.objectContaining({
          id: spoon.id,
          note: "After",
          nextTime: "Less salt",
          cookedAt: "2026-03-01T00:00:00.000Z",
          photoUrl: `https://spoonjoy.app/photos/spoons/${fixture.owner.id}/${fixture.recipe.id}/after.jpg`,
          chef: expect.objectContaining({ id: fixture.owner.id }),
        }),
        mutation: { clientMutationId: "spoon-update", replayed: false },
      },
    });

    const replay = await action(routeArgs(jsonRequest(url, "PATCH", fixture.ownerKitchenWrite.token, "req_spoon_update_replay", body), splat));
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      ok: true,
      requestId: "req_spoon_update_replay",
      data: { mutation: { clientMutationId: "spoon-update", replayed: true } },
    });

    const outsider = await action(routeArgs(jsonRequest(url, "PATCH", fixture.outsiderKitchenWrite.token, "req_spoon_update_outsider", {
      clientMutationId: "spoon-update-outsider",
      note: "Nope",
    }), splat));
    expect(outsider.status).toBe(403);

    const wrongRecipe = await action(routeArgs(jsonRequest(`http://localhost/api/v1/recipes/${fixture.otherRecipe.id}/spoons/${spoon.id}`, "PATCH", fixture.ownerKitchenWrite.token, "req_spoon_update_wrong_recipe", {
      clientMutationId: "spoon-update-wrong-recipe",
      note: "Wrong recipe",
    }), `recipes/${fixture.otherRecipe.id}/spoons/${spoon.id}`));
    expect(wrongRecipe.status).toBe(404);

    const invalidDate = await action(routeArgs(jsonRequest(url, "PATCH", fixture.ownerKitchenWrite.token, "req_spoon_update_invalid_date", {
      clientMutationId: "spoon-update-invalid-date",
      cookedAt: "bad",
    }), splat));
    expect(invalidDate.status).toBe(400);
  });

  it("soft-deletes spoons idempotently from body, header, or query mutation ids", async () => {
    const fixture = await createSpoonFixture(db);
    const bodyDeleted = await db.recipeSpoon.create({
      data: { chefId: fixture.owner.id, recipeId: fixture.recipe.id, note: "Body delete" },
    });
    const headerDeleted = await db.recipeSpoon.create({
      data: { chefId: fixture.owner.id, recipeId: fixture.recipe.id, note: "Header delete" },
    });
    const queryDeleted = await db.recipeSpoon.create({
      data: { chefId: fixture.owner.id, recipeId: fixture.recipe.id, note: "Query delete" },
    });

    const bodyUrl = `http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons/${bodyDeleted.id}`;
    const bodySplat = `recipes/${fixture.recipe.id}/spoons/${bodyDeleted.id}`;
    const response = await action(routeArgs(jsonRequest(bodyUrl, "DELETE", fixture.ownerKitchenWrite.token, "req_spoon_delete_body", {
      clientMutationId: "spoon-delete-body",
    }), bodySplat));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      requestId: "req_spoon_delete_body",
      data: {
        removed: true,
        spoon: expect.objectContaining({
          id: bodyDeleted.id,
          deletedAt: expect.any(String),
        }),
        mutation: { clientMutationId: "spoon-delete-body", replayed: false },
      },
    });

    const replay = await action(routeArgs(jsonRequest(bodyUrl, "DELETE", fixture.ownerKitchenWrite.token, "req_spoon_delete_body_replay", {
      clientMutationId: "spoon-delete-body",
    }), bodySplat));
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      ok: true,
      requestId: "req_spoon_delete_body_replay",
      data: { mutation: { clientMutationId: "spoon-delete-body", replayed: true } },
    });

    const headerUrl = `http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons/${headerDeleted.id}`;
    const headerResponse = await action(routeArgs(new UndiciRequest(headerUrl, {
      method: "DELETE",
      headers: bearer(fixture.ownerKitchenWrite.token, "req_spoon_delete_header", {
        "X-Client-Mutation-Id": "spoon-delete-header",
      }),
    }) as unknown as Request, `recipes/${fixture.recipe.id}/spoons/${headerDeleted.id}`));
    expect(headerResponse.status).toBe(200);
    await expect(headerResponse.json()).resolves.toMatchObject({
      data: {
        spoon: { id: headerDeleted.id },
        mutation: { clientMutationId: "spoon-delete-header", replayed: false },
      },
    });

    const queryUrl = `http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons/${queryDeleted.id}?clientMutationId=spoon-delete-query`;
    const queryResponse = await action(routeArgs(new UndiciRequest(queryUrl, {
      method: "DELETE",
      headers: bearer(fixture.ownerKitchenWrite.token, "req_spoon_delete_query"),
    }) as unknown as Request, `recipes/${fixture.recipe.id}/spoons/${queryDeleted.id}`));
    expect(queryResponse.status).toBe(200);
    await expect(queryResponse.json()).resolves.toMatchObject({
      data: {
        spoon: { id: queryDeleted.id },
        mutation: { clientMutationId: "spoon-delete-query", replayed: false },
      },
    });

    const outsiderSpoon = await db.recipeSpoon.create({
      data: { chefId: fixture.owner.id, recipeId: fixture.recipe.id, note: "Outsider delete" },
    });
    const outsider = await action(routeArgs(jsonRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons/${outsiderSpoon.id}`, "DELETE", fixture.outsiderKitchenWrite.token, "req_spoon_delete_outsider", {
      clientMutationId: "spoon-delete-outsider",
    }), `recipes/${fixture.recipe.id}/spoons/${outsiderSpoon.id}`));
    expect(outsider.status).toBe(403);

    const missingMutation = await action(routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons/${outsiderSpoon.id}`, {
      method: "DELETE",
      headers: bearer(fixture.ownerKitchenWrite.token, "req_spoon_delete_missing_mutation"),
    }) as unknown as Request, `recipes/${fixture.recipe.id}/spoons/${outsiderSpoon.id}`));
    expect(missingMutation.status).toBe(400);

    const wrongRecipe = await action(routeArgs(jsonRequest(`http://localhost/api/v1/recipes/${fixture.otherRecipe.id}/spoons/${outsiderSpoon.id}`, "DELETE", fixture.ownerKitchenWrite.token, "req_spoon_delete_wrong_recipe", {
      clientMutationId: "spoon-delete-wrong-recipe",
    }), `recipes/${fixture.otherRecipe.id}/spoons/${outsiderSpoon.id}`));
    expect(wrongRecipe.status).toBe(404);
  });
});
