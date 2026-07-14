import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import { action, loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../utils";

function routeArgs(request: Request, splat: string, context = { cloudflare: { env: null } }) {
  return { request, params: { "*": splat }, context } as any;
}

function backgroundContext(env: Record<string, unknown> | null = null) {
  return {
    cloudflare: {
      env,
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

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

function photoFile(name = "dish.png", bytes: Uint8Array = PNG_BYTES, type = "image/png") {
  return new File([bytes], name, { type });
}

function appendMultipartValue(formData: UndiciFormData, name: string, value: string | boolean | File | undefined) {
  if (value === undefined) return;
  formData.append(name, value instanceof File ? value : String(value));
}

function recipeImageForm(input: {
  clientMutationId?: string;
  photo?: File;
  activate?: boolean;
  generateEditorial?: boolean;
  postAsSpoon?: boolean;
  note?: string;
  nextTime?: string;
  cookedAt?: string;
  extraField?: string;
}) {
  const formData = new UndiciFormData();
  appendMultipartValue(formData, "clientMutationId", input.clientMutationId);
  appendMultipartValue(formData, "photo", input.photo);
  appendMultipartValue(formData, "activate", input.activate);
  appendMultipartValue(formData, "generateEditorial", input.generateEditorial);
  appendMultipartValue(formData, "postAsSpoon", input.postAsSpoon);
  appendMultipartValue(formData, "note", input.note);
  appendMultipartValue(formData, "nextTime", input.nextTime);
  appendMultipartValue(formData, "cookedAt", input.cookedAt);
  appendMultipartValue(formData, "unexpected", input.extraField);
  return formData;
}

function recipeImageUploadRequest(recipeId: string, token: string, requestId: string, formData: UndiciFormData) {
  return new UndiciRequest(`http://localhost/api/v1/recipes/${recipeId}/image`, {
    method: "POST",
    headers: bearer(token, requestId),
    body: formData,
    duplex: "half",
  }) as unknown as Request;
}

function mockPhotoBucket() {
  const keys = new Set<string>();
  return {
    keys,
    bucket: {
      put: vi.fn(async (key: string) => {
        keys.add(key);
      }),
      get: vi.fn(async (key: string) => keys.has(key) ? ({ key }) : null),
      delete: vi.fn(async (key: string) => {
        keys.delete(key);
      }),
    } as unknown as R2Bucket,
  };
}

async function createFirstPhotoFixture(db: Awaited<ReturnType<typeof getLocalDb>>) {
  const owner = await db.user.create({ data: createTestUser() });
  const outsider = await db.user.create({ data: createTestUser() });
  const recipe = await db.recipe.create({
    data: {
      ...createTestRecipe(owner.id),
      title: `API v1 first photo ${faker.string.alphanumeric(8)}`,
    },
  });

  return {
    owner,
    outsider,
    recipe,
    ownerKitchenWrite: await createApiCredential(db, owner.id, "First photo owner", { scopes: ["kitchen:write"] }),
    ownerShoppingWrite: await createApiCredential(db, owner.id, "First photo shopping only", { scopes: ["shopping_list:write"] }),
    outsiderKitchenWrite: await createApiCredential(db, outsider.id, "First photo outsider", { scopes: ["kitchen:write"] }),
  };
}

async function createCoverFixture(db: Awaited<ReturnType<typeof getLocalDb>>) {
  const owner = await db.user.create({ data: createTestUser() });
  const outsider = await db.user.create({ data: createTestUser() });
  const recipe = await db.recipe.create({
    data: {
      ...createTestRecipe(owner.id),
      title: `API v1 cover ${faker.string.alphanumeric(8)}`,
    },
  });
  const activeCover = await db.recipeCover.create({
    data: {
      recipeId: recipe.id,
      imageUrl: "/photos/covers/cover-active-raw.jpg",
      stylizedImageUrl: "/photos/covers/cover-active-editorial.jpg",
      sourceType: "chef-upload",
      status: "ready",
      sourceImageUrl: "/photos/uploads/cover-active-source.jpg",
      generationStatus: "succeeded",
      createdById: owner.id,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  const replacementCover = await db.recipeCover.create({
    data: {
      recipeId: recipe.id,
      imageUrl: "/photos/covers/cover-replacement-raw.jpg",
      stylizedImageUrl: "/photos/covers/cover-replacement-editorial.jpg",
      sourceType: "spoon",
      status: "ready",
      sourceImageUrl: "/photos/spoons/cover-replacement-source.jpg",
      generationStatus: "succeeded",
      createdById: owner.id,
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    },
  });
  const archivedCover = await db.recipeCover.create({
    data: {
      recipeId: recipe.id,
      imageUrl: "/photos/covers/cover-archived.jpg",
      sourceType: "import",
      status: "archived",
      archivedAt: new Date("2026-01-03T00:00:00.000Z"),
      createdAt: new Date("2026-01-03T00:00:00.000Z"),
    },
  });
  await db.recipe.update({
    where: { id: recipe.id },
    data: {
      activeCoverId: activeCover.id,
      activeCoverVariant: "stylized",
      coverMode: "manual",
    },
  });
  const spoon = await db.recipeSpoon.create({
    data: {
      chefId: owner.id,
      recipeId: recipe.id,
      photoUrl: "/photos/spoons/cover-source-spoon.jpg",
      note: "Photo available for cover creation",
      cookedAt: new Date("2026-01-04T00:00:00.000Z"),
    },
  });
  await db.recipeSpoon.create({
    data: {
      chefId: owner.id,
      recipeId: recipe.id,
      photoUrl: "",
      note: "Empty photo should not be listed",
      cookedAt: new Date("2026-01-05T00:00:00.000Z"),
    },
  });

  const ownerKitchenWrite = await createApiCredential(db, owner.id, "Cover owner", { scopes: ["kitchen:write"] });
  const ownerShoppingWrite = await createApiCredential(db, owner.id, "Cover shopping only", { scopes: ["shopping_list:write"] });
  const outsiderKitchenWrite = await createApiCredential(db, outsider.id, "Cover outsider", { scopes: ["kitchen:write"] });

  return {
    owner,
    outsider,
    recipe,
    activeCover,
    replacementCover,
    archivedCover,
    spoon,
    ownerKitchenWrite,
    ownerShoppingWrite,
    outsiderKitchenWrite,
  };
}

describe("API v1 recipe cover management", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.doUnmock("~/lib/recipe-cover.server");
    await cleanupDatabase();
  });

  it("requires kitchen write scope and owner access for cover management", async () => {
    const fixture = await createCoverFixture(db);
    const url = `http://localhost/api/v1/recipes/${fixture.recipe.id}/covers`;
    const splat = `recipes/${fixture.recipe.id}/covers`;

    const missing = await loader(routeArgs(new UndiciRequest(url, {
      headers: { "X-Request-Id": "req_cover_missing" },
    }) as unknown as Request, splat));
    expect(missing.status).toBe(401);
    expect(await readJson(missing)).toMatchObject({
      ok: false,
      requestId: "req_cover_missing",
      error: { code: "authentication_required", status: 401 },
    });

    const wrongScope = await loader(routeArgs(new UndiciRequest(url, {
      headers: bearer(fixture.ownerShoppingWrite.token, "req_cover_wrong_scope"),
    }) as unknown as Request, splat));
    expect(wrongScope.status).toBe(403);
    expect(await readJson(wrongScope)).toMatchObject({
      ok: false,
      requestId: "req_cover_wrong_scope",
      error: { code: "insufficient_scope", status: 403 },
    });

    const wrongOwner = await loader(routeArgs(new UndiciRequest(url, {
      headers: bearer(fixture.outsiderKitchenWrite.token, "req_cover_wrong_owner"),
    }) as unknown as Request, splat));
    expect(wrongOwner.status).toBe(403);
    expect(await readJson(wrongOwner)).toMatchObject({
      ok: false,
      requestId: "req_cover_wrong_owner",
      error: { code: "insufficient_scope", status: 403 },
    });
  });

  it("uploads a first recipe photo, preserves the original on a Spoon, and starts editorial cover generation by default", async () => {
    const fixture = await createFirstPhotoFixture(db);
    const photoBucket = mockPhotoBucket();
    const formData = recipeImageForm({
      clientMutationId: "first-photo-spoon-editorial",
      photo: photoFile("first-photo.png"),
      activate: true,
      postAsSpoon: true,
      note: "  Weeknight version  ",
      nextTime: "Use more lemon",
      cookedAt: "2026-02-03T04:05:06.000Z",
    });

    const response = await action(routeArgs(
      recipeImageUploadRequest(fixture.recipe.id, fixture.ownerKitchenWrite.token, "req_recipe_image_first_photo", formData),
      `recipes/${fixture.recipe.id}/image`,
      backgroundContext({ PHOTOS: photoBucket.bucket }),
    ));
    const payload = await readJson(response);

    expect(response.status).toBe(201);
    expect(photoBucket.bucket.put).toHaveBeenCalledTimes(1);
    const uploadedKey = vi.mocked(photoBucket.bucket.put).mock.calls[0][0] as string;
    expect(uploadedKey).toMatch(new RegExp(`^spoons/${fixture.owner.id}/${fixture.recipe.id}/\\d+-.*\\.png$`));
    expect(payload).toMatchObject({
      ok: true,
      requestId: "req_recipe_image_first_photo",
      data: {
        spoon: expect.objectContaining({
          chefId: fixture.owner.id,
          recipeId: fixture.recipe.id,
          photoUrl: `https://spoonjoy.app/photos/${uploadedKey}`,
          note: "Weeknight version",
          nextTime: "Use more lemon",
          cookedAt: "2026-02-03T04:05:06.000Z",
        }),
        activeCover: expect.objectContaining({
          activeVariant: "image",
          displayUrl: `https://spoonjoy.app/photos/${uploadedKey}`,
          generationStatus: "processing",
          provenanceLabel: "Original photo",
          sourceType: "spoon",
        }),
        createdCover: expect.objectContaining({
          imageUrl: `https://spoonjoy.app/photos/${uploadedKey}`,
          sourceImageUrl: `https://spoonjoy.app/photos/${uploadedKey}`,
          sourceType: "spoon",
          status: "processing",
          generationStatus: "processing",
          sourceSpoonId: expect.any(String),
        }),
        generationStatus: "processing",
        mutation: { clientMutationId: "first-photo-spoon-editorial", replayed: false },
      },
    });
    expect(payload.data.createdCover.sourceSpoonId).toBe(payload.data.spoon.id);
    await expect(db.recipeSpoon.findMany({ where: { chefId: fixture.owner.id, recipeId: fixture.recipe.id } }))
      .resolves.toMatchObject([{
        photoUrl: `/photos/${uploadedKey}`,
        note: "Weeknight version",
        nextTime: "Use more lemon",
        cookedAt: new Date("2026-02-03T04:05:06.000Z"),
      }]);
    await expect(db.recipe.findUniqueOrThrow({
      where: { id: fixture.recipe.id },
      select: { activeCoverId: true, activeCoverVariant: true, coverMode: true },
    })).resolves.toMatchObject({
      activeCoverId: payload.data.createdCover.id,
      activeCoverVariant: "image",
      coverMode: "manual",
    });
  });

  it("uploads a direct recipe cover without creating a Spoon when postAsSpoon and editorial generation are disabled", async () => {
    const fixture = await createFirstPhotoFixture(db);
    const photoBucket = mockPhotoBucket();
    const formData = recipeImageForm({
      clientMutationId: "first-photo-direct-cover",
      photo: photoFile("direct-cover.webp", WEBP_BYTES, "image/webp"),
      activate: true,
      generateEditorial: false,
      postAsSpoon: false,
    });

    const response = await action(routeArgs(
      recipeImageUploadRequest(fixture.recipe.id, fixture.ownerKitchenWrite.token, "req_recipe_image_direct_cover", formData),
      `recipes/${fixture.recipe.id}/image`,
      backgroundContext({ PHOTOS: photoBucket.bucket }),
    ));
    const payload = await readJson(response);

    expect(response.status).toBe(201);
    const uploadedKey = vi.mocked(photoBucket.bucket.put).mock.calls[0][0] as string;
    expect(uploadedKey).toMatch(new RegExp(`^recipes/${fixture.owner.id}/${fixture.recipe.id}/\\d+-.*\\.webp$`));
    expect(payload).toMatchObject({
      ok: true,
      requestId: "req_recipe_image_direct_cover",
      data: {
        spoon: null,
        activeCover: expect.objectContaining({
          activeVariant: "image",
          displayUrl: `https://spoonjoy.app/photos/${uploadedKey}`,
          generationStatus: "none",
          provenanceLabel: "Original photo",
          sourceType: "chef-upload",
        }),
        createdCover: expect.objectContaining({
          imageUrl: `https://spoonjoy.app/photos/${uploadedKey}`,
          sourceImageUrl: `https://spoonjoy.app/photos/${uploadedKey}`,
          sourceType: "chef-upload",
          status: "ready",
          generationStatus: "none",
          sourceSpoonId: null,
        }),
        generationStatus: "none",
        mutation: { clientMutationId: "first-photo-direct-cover", replayed: false },
      },
    });
    await expect(db.recipeSpoon.count({ where: { recipeId: fixture.recipe.id } })).resolves.toBe(0);
  });

  it("validates first-photo upload auth, multipart fields, and image files before writing storage or database rows", async () => {
    const fixture = await createFirstPhotoFixture(db);
    const cases = [
      {
        requestId: "req_recipe_image_missing_photo",
        token: fixture.ownerKitchenWrite.token,
        formData: recipeImageForm({ clientMutationId: "first-photo-missing-photo", activate: true }),
        status: 400,
        code: "validation_error",
      },
      {
        requestId: "req_recipe_image_bad_type",
        token: fixture.ownerKitchenWrite.token,
        formData: recipeImageForm({
          clientMutationId: "first-photo-bad-type",
          photo: photoFile("notes.txt", new TextEncoder().encode("hello"), "text/plain"),
        }),
        status: 400,
        code: "validation_error",
      },
      {
        requestId: "req_recipe_image_bad_boolean",
        token: fixture.ownerKitchenWrite.token,
        formData: recipeImageForm({ clientMutationId: "first-photo-bad-boolean", photo: photoFile(), activate: true }),
        mutate(formData: UndiciFormData) {
          formData.set("activate", "absolutely");
        },
        status: 400,
        code: "validation_error",
      },
      {
        requestId: "req_recipe_image_extra_field",
        token: fixture.ownerKitchenWrite.token,
        formData: recipeImageForm({ clientMutationId: "first-photo-extra-field", photo: photoFile(), extraField: "nope" }),
        status: 400,
        code: "validation_error",
      },
      {
        requestId: "req_recipe_image_wrong_scope",
        token: fixture.ownerShoppingWrite.token,
        formData: recipeImageForm({ clientMutationId: "first-photo-wrong-scope", photo: photoFile() }),
        status: 403,
        code: "insufficient_scope",
      },
      {
        requestId: "req_recipe_image_wrong_owner",
        token: fixture.outsiderKitchenWrite.token,
        formData: recipeImageForm({ clientMutationId: "first-photo-wrong-owner", photo: photoFile() }),
        status: 403,
        code: "insufficient_scope",
      },
    ];

    for (const testCase of cases) {
      const photoBucket = mockPhotoBucket();
      testCase.mutate?.(testCase.formData);
      const response = await action(routeArgs(
        recipeImageUploadRequest(fixture.recipe.id, testCase.token, testCase.requestId, testCase.formData),
        `recipes/${fixture.recipe.id}/image`,
        backgroundContext({ PHOTOS: photoBucket.bucket }),
      ));
      expect(response.status).toBe(testCase.status);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        requestId: testCase.requestId,
        error: { code: testCase.code, status: testCase.status },
      });
      expect(photoBucket.bucket.put).not.toHaveBeenCalled();
    }
    await expect(db.recipeCover.count({ where: { recipeId: fixture.recipe.id } })).resolves.toBe(0);
    await expect(db.recipeSpoon.count({ where: { recipeId: fixture.recipe.id } })).resolves.toBe(0);
  });

  it("replays first-photo uploads idempotently and rejects conflicting multipart bodies", async () => {
    const fixture = await createFirstPhotoFixture(db);
    const photoBucket = mockPhotoBucket();
    const body = {
      clientMutationId: "first-photo-replay",
      photo: photoFile("replay.png"),
      activate: true,
      generateEditorial: true,
      postAsSpoon: true,
      note: "Replayable dinner",
    };

    const first = await action(routeArgs(
      recipeImageUploadRequest(fixture.recipe.id, fixture.ownerKitchenWrite.token, "req_recipe_image_replay_first", recipeImageForm(body)),
      `recipes/${fixture.recipe.id}/image`,
      backgroundContext({ PHOTOS: photoBucket.bucket }),
    ));
    const firstPayload = await readJson(first);
    expect(first.status).toBe(201);

    const replay = await action(routeArgs(
      recipeImageUploadRequest(fixture.recipe.id, fixture.ownerKitchenWrite.token, "req_recipe_image_replay_second", recipeImageForm({
        ...body,
        photo: photoFile("renamed-replay.png"),
      })),
      `recipes/${fixture.recipe.id}/image`,
      backgroundContext({ PHOTOS: photoBucket.bucket }),
    ));
    expect(replay.status).toBe(201);
    await expect(replay.json()).resolves.toMatchObject({
      ok: true,
      requestId: "req_recipe_image_replay_second",
      data: {
        spoon: { id: firstPayload.data.spoon.id },
        createdCover: { id: firstPayload.data.createdCover.id },
        mutation: { clientMutationId: "first-photo-replay", replayed: true },
      },
    });
    expect(photoBucket.bucket.put).toHaveBeenCalledTimes(1);

    const conflict = await action(routeArgs(
      recipeImageUploadRequest(fixture.recipe.id, fixture.ownerKitchenWrite.token, "req_recipe_image_replay_conflict", recipeImageForm({
        ...body,
        note: "Different note",
      })),
      `recipes/${fixture.recipe.id}/image`,
      backgroundContext({ PHOTOS: photoBucket.bucket }),
    ));
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      ok: false,
      requestId: "req_recipe_image_replay_conflict",
      error: { code: "idempotency_conflict", status: 409 },
    });
  });

  it("deletes an uploaded first-photo object when a later database write fails", async () => {
    const fixture = await createFirstPhotoFixture(db);
    const photoBucket = mockPhotoBucket();
    const originalCreate = db.recipeCover.create;
    const createSpy = vi.fn().mockRejectedValueOnce(new Error("cover write failed after upload"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.recipeCover.create = createSpy as unknown as typeof db.recipeCover.create;

    try {
      const response = await action(routeArgs(
        recipeImageUploadRequest(fixture.recipe.id, fixture.ownerKitchenWrite.token, "req_recipe_image_orphan_cleanup", recipeImageForm({
          clientMutationId: "first-photo-orphan-cleanup",
          photo: photoFile("orphan.png"),
          activate: true,
          postAsSpoon: true,
          generateEditorial: true,
        })),
        `recipes/${fixture.recipe.id}/image`,
        backgroundContext({ PHOTOS: photoBucket.bucket }),
      ));

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        requestId: "req_recipe_image_orphan_cleanup",
        error: { code: "internal_error", status: 500 },
      });
      const uploadedKey = vi.mocked(photoBucket.bucket.put).mock.calls[0][0] as string;
      expect(photoBucket.bucket.delete).toHaveBeenCalledWith(uploadedKey);
      await expect(db.recipeCover.count({ where: { recipeId: fixture.recipe.id } })).resolves.toBe(0);
      await expect(db.recipeSpoon.count({ where: { recipeId: fixture.recipe.id } })).resolves.toBe(0);
      await expect(db.apiIdempotencyKey.findFirst({
        where: {
          userId: fixture.owner.id,
          key: "first-photo-orphan-cleanup",
        },
      })).resolves.toBeNull();
    } finally {
      db.recipeCover.create = originalCreate;
      errorSpy.mockRestore();
    }
  });

  it("validates recipe existence and cover list pagination", async () => {
    const fixture = await createCoverFixture(db);
    const missingRecipeId = "recipe_missing";
    const missing = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${missingRecipeId}/covers`, {
      headers: bearer(fixture.ownerKitchenWrite.token, "req_cover_missing_recipe"),
    }) as unknown as Request, `recipes/${missingRecipeId}/covers`));
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      ok: false,
      requestId: "req_cover_missing_recipe",
      error: {
        code: "not_found",
        status: 404,
        details: { resource: "recipe", recipeId: missingRecipeId },
      },
    });

    const invalidOffset = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}/covers?offset=-1`, {
      headers: bearer(fixture.ownerKitchenWrite.token, "req_cover_invalid_offset"),
    }) as unknown as Request, `recipes/${fixture.recipe.id}/covers`));
    expect(invalidOffset.status).toBe(400);
    await expect(invalidOffset.json()).resolves.toMatchObject({
      ok: false,
      requestId: "req_cover_invalid_offset",
      error: {
        code: "validation_error",
        status: 400,
        message: "offset must be an integer greater than or equal to 0",
      },
    });

    const emptyDisplayCover = await db.recipeCover.create({
      data: {
        recipeId: fixture.recipe.id,
        imageUrl: "",
        sourceType: "import",
        status: "ready",
        generationStatus: "none",
        createdAt: new Date("2026-01-06T00:00:00.000Z"),
      },
    });
    const emptyDisplay = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}/covers?limit=1`, {
      headers: bearer(fixture.ownerKitchenWrite.token, "req_cover_empty_display"),
    }) as unknown as Request, `recipes/${fixture.recipe.id}/covers`));
    expect(emptyDisplay.status).toBe(200);
    await expect(emptyDisplay.json()).resolves.toMatchObject({
      ok: true,
      requestId: "req_cover_empty_display",
      data: {
        covers: [
          expect.objectContaining({
            id: emptyDisplayCover.id,
            activeVariant: null,
            displayUrl: null,
            provenanceLabel: null,
          }),
        ],
      },
    });

    const positiveOffset = await loader(routeArgs(new UndiciRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}/covers?limit=1&offset=1`, {
      headers: bearer(fixture.ownerKitchenWrite.token, "req_cover_positive_offset"),
    }) as unknown as Request, `recipes/${fixture.recipe.id}/covers`));
    expect(positiveOffset.status).toBe(200);
    await expect(positiveOffset.json()).resolves.toMatchObject({
      ok: true,
      requestId: "req_cover_positive_offset",
      data: {
        pagination: { limit: 1, offset: 1, hasMore: true },
      },
    });
  });

  it("lists active cover candidates and spoon photo sources for the owner", async () => {
    const fixture = await createCoverFixture(db);
    const url = `http://localhost/api/v1/recipes/${fixture.recipe.id}/covers?limit=10`;
    const response = await loader(routeArgs(new UndiciRequest(url, {
      headers: bearer(fixture.ownerKitchenWrite.token, "req_cover_list"),
    }) as unknown as Request, `recipes/${fixture.recipe.id}/covers`));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(payload).toMatchObject({
      ok: true,
      requestId: "req_cover_list",
      data: {
        covers: [
          expect.objectContaining({
            id: fixture.replacementCover.id,
            imageUrl: "https://spoonjoy.app/photos/covers/cover-replacement-raw.jpg",
            stylizedImageUrl: "https://spoonjoy.app/photos/covers/cover-replacement-editorial.jpg",
            displayUrl: "https://spoonjoy.app/photos/covers/cover-replacement-editorial.jpg",
            activeVariant: null,
            provenanceLabel: "Editorial photo",
            sourceType: "spoon",
          }),
          expect.objectContaining({
            id: fixture.activeCover.id,
            displayUrl: "https://spoonjoy.app/photos/covers/cover-active-editorial.jpg",
            activeVariant: "stylized",
            provenanceLabel: "Editorial photo",
            sourceImageUrl: "https://spoonjoy.app/photos/uploads/cover-active-source.jpg",
          }),
        ],
        activeCover: expect.objectContaining({
          id: fixture.activeCover.id,
          activeVariant: "stylized",
        }),
        spoonImages: [
          expect.objectContaining({
            id: fixture.spoon.id,
            photoUrl: "https://spoonjoy.app/photos/spoons/cover-source-spoon.jpg",
            chef: expect.objectContaining({ id: fixture.owner.id, username: fixture.owner.username }),
          }),
        ],
        pagination: { limit: 10, offset: 0, nextOffset: null, hasMore: false },
      },
    });
    expect(payload.data.covers.map((cover: { id: string }) => cover.id)).not.toContain(fixture.archivedCover.id);

    const archivedResponse = await loader(routeArgs(new UndiciRequest(`${url}&includeArchived=true`, {
      headers: bearer(fixture.ownerKitchenWrite.token, "req_cover_list_archived"),
    }) as unknown as Request, `recipes/${fixture.recipe.id}/covers`));
    const archivedPayload = await readJson(archivedResponse);
    expect(archivedResponse.status).toBe(200);
    expect(archivedPayload.data.covers.map((cover: { id: string }) => cover.id)).toContain(fixture.archivedCover.id);
  });

  it("activates cover variants idempotently and rejects conflicting replays", async () => {
    const fixture = await createCoverFixture(db);
    const url = `http://localhost/api/v1/recipes/${fixture.recipe.id}/covers/${fixture.replacementCover.id}`;
    const splat = `recipes/${fixture.recipe.id}/covers/${fixture.replacementCover.id}`;
    const body = { clientMutationId: "activate-replacement-cover", variant: "image" };

    const response = await action(routeArgs(jsonRequest(url, "PATCH", fixture.ownerKitchenWrite.token, "req_cover_activate", body), splat));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      requestId: "req_cover_activate",
      data: {
        activeCover: expect.objectContaining({
          id: fixture.replacementCover.id,
          activeVariant: "image",
          displayUrl: "https://spoonjoy.app/photos/covers/cover-replacement-raw.jpg",
        }),
        previousActiveCover: expect.objectContaining({ id: fixture.activeCover.id, activeVariant: "stylized" }),
        mutation: { clientMutationId: "activate-replacement-cover", replayed: false },
      },
    });

    const replay = await action(routeArgs(jsonRequest(url, "PATCH", fixture.ownerKitchenWrite.token, "req_cover_activate_replay", body), splat));
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      ok: true,
      requestId: "req_cover_activate_replay",
      data: { mutation: { clientMutationId: "activate-replacement-cover", replayed: true } },
    });

    const conflict = await action(routeArgs(jsonRequest(url, "PATCH", fixture.ownerKitchenWrite.token, "req_cover_activate_conflict", {
      clientMutationId: "activate-replacement-cover",
      variant: "stylized",
    }), splat));
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      ok: false,
      requestId: "req_cover_activate_conflict",
      error: { code: "idempotency_conflict", status: 409 },
    });

    const invalidVariant = await action(routeArgs(jsonRequest(url, "PATCH", fixture.ownerKitchenWrite.token, "req_cover_activate_invalid_variant", {
      clientMutationId: "activate-replacement-cover-invalid-variant",
      variant: "thumbnail",
    }), splat));
    expect(invalidVariant.status).toBe(400);
    await expect(invalidVariant.json()).resolves.toMatchObject({
      ok: false,
      requestId: "req_cover_activate_invalid_variant",
      error: {
        code: "validation_error",
        status: 400,
        message: "variant must be image or stylized",
      },
    });
  });

  it("returns not_found for stale cover activate and archive ids", async () => {
    const fixture = await createCoverFixture(db);
    const missingCoverID = "cover_missing";
    const missingUrl = `http://localhost/api/v1/recipes/${fixture.recipe.id}/covers/${missingCoverID}`;
    const missingSplat = `recipes/${fixture.recipe.id}/covers/${missingCoverID}`;

    const activate = await action(routeArgs(jsonRequest(missingUrl, "PATCH", fixture.ownerKitchenWrite.token, "req_cover_activate_missing", {
      clientMutationId: "activate-missing-cover",
      variant: "image",
    }), missingSplat));
    expect(activate.status).toBe(404);
    await expect(activate.json()).resolves.toMatchObject({
      ok: false,
      requestId: "req_cover_activate_missing",
      error: {
        code: "not_found",
        status: 404,
        details: { resource: "recipe_cover", coverId: missingCoverID },
      },
    });

    const archive = await action(routeArgs(jsonRequest(missingUrl, "DELETE", fixture.ownerKitchenWrite.token, "req_cover_archive_missing", {
      clientMutationId: "archive-missing-cover",
      confirmNoCover: true,
    }), missingSplat));
    expect(archive.status).toBe(404);
    await expect(archive.json()).resolves.toMatchObject({
      ok: false,
      requestId: "req_cover_archive_missing",
      error: {
        code: "not_found",
        status: 404,
        details: { resource: "recipe_cover", coverId: missingCoverID },
      },
    });
  });

  it("rejects regenerating covers that have no source image", async () => {
    const fixture = await createCoverFixture(db);
    const emptySourceCover = await db.recipeCover.create({
      data: {
        recipeId: fixture.recipe.id,
        imageUrl: "",
        sourceImageUrl: "",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "none",
        createdById: fixture.owner.id,
      },
    });
    const fallbackSourceCover = await db.recipeCover.create({
      data: {
        recipeId: fixture.recipe.id,
        imageUrl: "/photos/covers/cover-fallback-source.jpg",
        sourceType: "import",
        status: "ready",
        generationStatus: "none",
        createdById: fixture.owner.id,
      },
    });
    const url = `http://localhost/api/v1/recipes/${fixture.recipe.id}/covers/regenerate`;
    const missingResponse = await action(routeArgs(jsonRequest(url, "POST", fixture.ownerKitchenWrite.token, "req_cover_regenerate_missing", {
      clientMutationId: "cover-regenerate-missing",
      coverId: "cover_missing",
    }), `recipes/${fixture.recipe.id}/covers/regenerate`));
    expect(missingResponse.status).toBe(404);
    await expect(missingResponse.json()).resolves.toMatchObject({
      ok: false,
      requestId: "req_cover_regenerate_missing",
      error: {
        code: "not_found",
        status: 404,
        details: { resource: "recipe_cover", coverId: "cover_missing" },
      },
    });

    const archivedResponse = await action(routeArgs(jsonRequest(url, "POST", fixture.ownerKitchenWrite.token, "req_cover_regenerate_archived", {
      clientMutationId: "cover-regenerate-archived",
      coverId: fixture.archivedCover.id,
    }), `recipes/${fixture.recipe.id}/covers/regenerate`));
    expect(archivedResponse.status).toBe(400);
    await expect(archivedResponse.json()).resolves.toMatchObject({
      ok: false,
      requestId: "req_cover_regenerate_archived",
      error: {
        code: "validation_error",
        status: 400,
        message: "Archived covers cannot be regenerated",
      },
    });

    const response = await action(routeArgs(jsonRequest(url, "POST", fixture.ownerKitchenWrite.token, "req_cover_regenerate_empty_source", {
      clientMutationId: "cover-regenerate-empty-source",
      coverId: emptySourceCover.id,
    }), `recipes/${fixture.recipe.id}/covers/regenerate`));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      requestId: "req_cover_regenerate_empty_source",
      error: {
        code: "validation_error",
        status: 400,
        message: "Cover has no source image",
      },
    });

    const fallbackSourceResponse = await action(routeArgs(jsonRequest(url, "POST", fixture.ownerKitchenWrite.token, "req_cover_regenerate_fallback_source", {
      clientMutationId: "cover-regenerate-fallback-source",
      coverId: fallbackSourceCover.id,
      activateWhenReady: false,
    }), `recipes/${fixture.recipe.id}/covers/regenerate`, backgroundContext()));
    const fallbackSourcePayload = await readJson(fallbackSourceResponse);
    const updatedFallbackCover = await db.recipeCover.findUniqueOrThrow({ where: { id: fallbackSourceCover.id } });

    expect(fallbackSourceResponse.status).toBe(200);
    expect(fallbackSourcePayload).toMatchObject({
      ok: true,
      requestId: "req_cover_regenerate_fallback_source",
      data: {
        activeCover: expect.objectContaining({ id: fixture.activeCover.id }),
        createdCover: expect.objectContaining({
          id: fallbackSourceCover.id,
          sourceType: "import",
          status: "processing",
          generationStatus: "processing",
          sourceImageUrl: "https://spoonjoy.app/photos/covers/cover-fallback-source.jpg",
        }),
        generationStatus: "processing",
        mutation: { clientMutationId: "cover-regenerate-fallback-source", replayed: false },
      },
    });
    expect(updatedFallbackCover.sourceImageUrl).toBe("/photos/covers/cover-fallback-source.jpg");
  });

  it("sets an explicit no-cover state only after destructive confirmation", async () => {
    const fixture = await createCoverFixture(db);
    const url = `http://localhost/api/v1/recipes/${fixture.recipe.id}/covers`;
    const splat = `recipes/${fixture.recipe.id}/covers`;

    const rejected = await action(routeArgs(jsonRequest(url, "PATCH", fixture.ownerKitchenWrite.token, "req_cover_none_reject", {
      clientMutationId: "set-no-cover-reject",
      confirmNoCover: false,
    }), splat));
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toMatchObject({
      ok: false,
      requestId: "req_cover_none_reject",
      error: { code: "validation_error", status: 400 },
    });

    const response = await action(routeArgs(jsonRequest(url, "PATCH", fixture.ownerKitchenWrite.token, "req_cover_none", {
      clientMutationId: "set-no-cover",
      confirmNoCover: true,
    }), splat));
    const payload = await readJson(response);
    const recipe = await db.recipe.findUniqueOrThrow({ where: { id: fixture.recipe.id } });

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      requestId: "req_cover_none",
      data: {
        activeCover: null,
        previousActiveCover: expect.objectContaining({ id: fixture.activeCover.id }),
        mutation: { clientMutationId: "set-no-cover", replayed: false },
      },
    });
    expect(recipe).toMatchObject({ activeCoverId: null, activeCoverVariant: null, coverMode: "none" });
  });

  it("handles stale active cover pointers when clearing covers", async () => {
    const fixture = await createCoverFixture(db);
    const otherRecipe = await db.recipe.create({
      data: {
        ...createTestRecipe(fixture.owner.id),
        title: `Other cover recipe ${faker.string.alphanumeric(8)}`,
      },
    });
    const otherCover = await db.recipeCover.create({
      data: {
        recipeId: otherRecipe.id,
        imageUrl: "/photos/covers/other-recipe-cover.jpg",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "none",
        createdById: fixture.owner.id,
      },
    });
    await db.recipe.update({
      where: { id: fixture.recipe.id },
      data: {
        activeCoverId: otherCover.id,
        activeCoverVariant: "image",
        coverMode: "manual",
      },
    });

    const url = `http://localhost/api/v1/recipes/${fixture.recipe.id}/covers`;
    const response = await action(routeArgs(jsonRequest(url, "PATCH", fixture.ownerKitchenWrite.token, "req_cover_none_stale_active", {
      clientMutationId: "set-no-cover-stale-active",
      confirmNoCover: true,
    }), `recipes/${fixture.recipe.id}/covers`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      requestId: "req_cover_none_stale_active",
      data: {
        activeCover: null,
        previousActiveCover: null,
        mutation: { clientMutationId: "set-no-cover-stale-active", replayed: false },
      },
    });
  });

  it("archives active covers with replacement or no-cover confirmation", async () => {
    const fixture = await createCoverFixture(db);
    const inactiveCover = await db.recipeCover.create({
      data: {
        recipeId: fixture.recipe.id,
        imageUrl: "/photos/covers/cover-inactive-archive.jpg",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "none",
        createdById: fixture.owner.id,
      },
    });
    const inactiveUrl = `http://localhost/api/v1/recipes/${fixture.recipe.id}/covers/${inactiveCover.id}`;
    const inactiveSplat = `recipes/${fixture.recipe.id}/covers/${inactiveCover.id}`;
    const inactiveResponse = await action(routeArgs(jsonRequest(inactiveUrl, "DELETE", fixture.ownerKitchenWrite.token, "req_cover_archive_inactive", {
      clientMutationId: "archive-inactive",
      deleteSafeObjects: false,
    }), inactiveSplat));
    const inactivePayload = await readJson(inactiveResponse);

    expect(inactiveResponse.status).toBe(200);
    expect(inactivePayload).toMatchObject({
      ok: true,
      requestId: "req_cover_archive_inactive",
      data: {
        activeCover: expect.objectContaining({ id: fixture.activeCover.id }),
        archivedCover: expect.objectContaining({ id: inactiveCover.id, status: "archived" }),
        warnings: [],
        mutation: { clientMutationId: "archive-inactive", replayed: false },
      },
    });

    const headerMutationCover = await db.recipeCover.create({
      data: {
        recipeId: fixture.recipe.id,
        imageUrl: "/photos/covers/cover-header-mutation.jpg",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "none",
        createdById: fixture.owner.id,
      },
    });
    const headerMutationUrl = `http://localhost/api/v1/recipes/${fixture.recipe.id}/covers/${headerMutationCover.id}`;
    const headerMutationResponse = await action(routeArgs(new UndiciRequest(headerMutationUrl, {
      method: "DELETE",
      headers: bearer(fixture.ownerKitchenWrite.token, "req_cover_archive_header_mutation", {
        "Content-Type": "application/json",
        "X-Client-Mutation-Id": "archive-inactive-header",
      }),
      body: JSON.stringify({ deleteSafeObjects: false }),
    }) as unknown as Request, `recipes/${fixture.recipe.id}/covers/${headerMutationCover.id}`));
    expect(headerMutationResponse.status).toBe(200);
    await expect(headerMutationResponse.json()).resolves.toMatchObject({
      ok: true,
      requestId: "req_cover_archive_header_mutation",
      data: {
        archivedCover: expect.objectContaining({ id: headerMutationCover.id, status: "archived" }),
        warnings: [],
        mutation: { clientMutationId: "archive-inactive-header", replayed: false },
      },
    });

    const queryMutationCover = await db.recipeCover.create({
      data: {
        recipeId: fixture.recipe.id,
        imageUrl: "/photos/covers/cover-query-mutation.jpg",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "none",
        createdById: fixture.owner.id,
      },
    });
    const queryMutationUrl = `http://localhost/api/v1/recipes/${fixture.recipe.id}/covers/${queryMutationCover.id}?clientMutationId=archive-inactive-query`;
    const queryMutationResponse = await action(routeArgs(new UndiciRequest(queryMutationUrl, {
      method: "DELETE",
      headers: bearer(fixture.ownerKitchenWrite.token, "req_cover_archive_query_mutation", {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ deleteSafeObjects: false }),
    }) as unknown as Request, `recipes/${fixture.recipe.id}/covers/${queryMutationCover.id}`));
    expect(queryMutationResponse.status).toBe(200);
    await expect(queryMutationResponse.json()).resolves.toMatchObject({
      ok: true,
      requestId: "req_cover_archive_query_mutation",
      data: {
        archivedCover: expect.objectContaining({ id: queryMutationCover.id, status: "archived" }),
        warnings: [],
        mutation: { clientMutationId: "archive-inactive-query", replayed: false },
      },
    });

    const url = `http://localhost/api/v1/recipes/${fixture.recipe.id}/covers/${fixture.activeCover.id}`;
    const splat = `recipes/${fixture.recipe.id}/covers/${fixture.activeCover.id}`;

    const rejected = await action(routeArgs(jsonRequest(url, "DELETE", fixture.ownerKitchenWrite.token, "req_cover_archive_reject", {
      clientMutationId: "archive-active-reject",
    }), splat));
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toMatchObject({
      ok: false,
      requestId: "req_cover_archive_reject",
      error: { code: "validation_error", status: 400 },
    });

    const response = await action(routeArgs(jsonRequest(url, "DELETE", fixture.ownerKitchenWrite.token, "req_cover_archive", {
      clientMutationId: "archive-active",
      replacementCoverId: fixture.replacementCover.id,
      replacementVariant: "image",
      deleteSafeObjects: true,
    }), splat));
    const payload = await readJson(response);
    const archived = await db.recipeCover.findUniqueOrThrow({ where: { id: fixture.activeCover.id } });
    const recipe = await db.recipe.findUniqueOrThrow({ where: { id: fixture.recipe.id } });

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      requestId: "req_cover_archive",
      data: {
        activeCover: expect.objectContaining({ id: fixture.replacementCover.id, activeVariant: "image" }),
        previousActiveCover: expect.objectContaining({ id: fixture.activeCover.id, activeVariant: "stylized" }),
        archivedCover: expect.objectContaining({ id: fixture.activeCover.id, status: "archived" }),
        warnings: ["deleteSafeObjects is not implemented; the cover record was archived without deleting image objects."],
        mutation: { clientMutationId: "archive-active", replayed: false },
      },
    });
    expect(archived.status).toBe("archived");
    expect(archived.archivedAt).toBeTruthy();
    expect(recipe).toMatchObject({
      activeCoverId: fixture.replacementCover.id,
      activeCoverVariant: "image",
      coverMode: "manual",
    });
  });

  it("creates covers from spoon photos and regenerates editorial variants through waitUntil", async () => {
    const fixture = await createCoverFixture(db);
    const createUrl = `http://localhost/api/v1/recipes/${fixture.recipe.id}/covers/from-spoon/${fixture.spoon.id}`;
    const createSplat = `recipes/${fixture.recipe.id}/covers/from-spoon/${fixture.spoon.id}`;

    const createResponse = await action(routeArgs(jsonRequest(createUrl, "POST", fixture.ownerKitchenWrite.token, "req_cover_from_spoon", {
      clientMutationId: "cover-from-spoon",
      activate: true,
      generateEditorial: false,
    }), createSplat));
    const createPayload = await readJson(createResponse);

    expect(createResponse.status).toBe(201);
    expect(createPayload).toMatchObject({
      ok: true,
      requestId: "req_cover_from_spoon",
      data: {
        activeCover: expect.objectContaining({
          sourceType: "spoon",
          activeVariant: "image",
          imageUrl: "https://spoonjoy.app/photos/spoons/cover-source-spoon.jpg",
        }),
        createdCover: expect.objectContaining({
          sourceType: "spoon",
          sourceSpoonId: fixture.spoon.id,
          generationStatus: "none",
        }),
        generationStatus: "none",
        mutation: { clientMutationId: "cover-from-spoon", replayed: false },
      },
    });

    const createdCoverId = createPayload.data.createdCover.id as string;
    const regenerateUrl = `http://localhost/api/v1/recipes/${fixture.recipe.id}/covers/regenerate`;
    const regenerateResponse = await action(routeArgs(jsonRequest(regenerateUrl, "POST", fixture.ownerKitchenWrite.token, "req_cover_regenerate", {
      clientMutationId: "cover-regenerate",
      coverId: createdCoverId,
      activateWhenReady: true,
    }), `recipes/${fixture.recipe.id}/covers/regenerate`, backgroundContext()));
    const regeneratePayload = await readJson(regenerateResponse);

    expect(regenerateResponse.status).toBe(200);
    expect(regeneratePayload).toMatchObject({
      ok: true,
      requestId: "req_cover_regenerate",
      data: {
        createdCover: expect.objectContaining({
          id: createdCoverId,
          status: "processing",
          generationStatus: "processing",
        }),
        generationStatus: "processing",
        mutation: { clientMutationId: "cover-regenerate", replayed: false },
      },
    });

    const inactiveCreateResponse = await action(routeArgs(jsonRequest(createUrl, "POST", fixture.ownerKitchenWrite.token, "req_cover_from_spoon_inactive", {
      clientMutationId: "cover-from-spoon-inactive",
      activate: false,
      generateEditorial: false,
    }), createSplat));
    const inactiveCreatePayload = await readJson(inactiveCreateResponse);

    expect(inactiveCreateResponse.status).toBe(201);
    expect(inactiveCreatePayload).toMatchObject({
      ok: true,
      requestId: "req_cover_from_spoon_inactive",
      data: {
        activeCover: expect.objectContaining({
          id: createdCoverId,
          activeVariant: "image",
        }),
        createdCover: expect.objectContaining({
          sourceType: "spoon",
          sourceSpoonId: fixture.spoon.id,
          generationStatus: "none",
        }),
        generationStatus: "none",
        mutation: { clientMutationId: "cover-from-spoon-inactive", replayed: false },
      },
    });

    const inactiveCoverId = inactiveCreatePayload.data.createdCover.id as string;
    const regenerateInactiveResponse = await action(routeArgs(jsonRequest(regenerateUrl, "POST", fixture.ownerKitchenWrite.token, "req_cover_regenerate_inactive", {
      clientMutationId: "cover-regenerate-inactive",
      coverId: inactiveCoverId,
      activateWhenReady: false,
    }), `recipes/${fixture.recipe.id}/covers/regenerate`, backgroundContext()));
    const regenerateInactivePayload = await readJson(regenerateInactiveResponse);

    expect(regenerateInactiveResponse.status).toBe(200);
    expect(regenerateInactivePayload).toMatchObject({
      ok: true,
      requestId: "req_cover_regenerate_inactive",
      data: {
        activeCover: expect.objectContaining({
          id: createdCoverId,
          activeVariant: "image",
        }),
        createdCover: expect.objectContaining({
          id: inactiveCoverId,
          status: "processing",
          generationStatus: "processing",
        }),
        generationStatus: "processing",
        mutation: { clientMutationId: "cover-regenerate-inactive", replayed: false },
      },
    });

    const editorialResponse = await action(routeArgs(jsonRequest(createUrl, "POST", fixture.ownerKitchenWrite.token, "req_cover_from_spoon_editorial", {
      clientMutationId: "cover-from-spoon-editorial",
      activate: false,
      generateEditorial: true,
    }), createSplat, backgroundContext()));
    const editorialPayload = await readJson(editorialResponse);

    expect(editorialResponse.status).toBe(201);
    expect(editorialPayload).toMatchObject({
      ok: true,
      requestId: "req_cover_from_spoon_editorial",
      data: {
        activeCover: expect.objectContaining({
          id: createdCoverId,
          activeVariant: "image",
        }),
        createdCover: expect.objectContaining({
          sourceType: "spoon",
          sourceSpoonId: fixture.spoon.id,
          status: "processing",
          generationStatus: "processing",
        }),
        generationStatus: "processing",
        mutation: { clientMutationId: "cover-from-spoon-editorial", replayed: false },
      },
    });

    const activatingEditorialResponse = await action(routeArgs(jsonRequest(createUrl, "POST", fixture.ownerKitchenWrite.token, "req_cover_from_spoon_editorial_activate", {
      clientMutationId: "cover-from-spoon-editorial-activate",
      activate: true,
      generateEditorial: true,
    }), createSplat, backgroundContext()));
    const activatingEditorialPayload = await readJson(activatingEditorialResponse);

    expect(activatingEditorialResponse.status).toBe(201);
    expect(activatingEditorialPayload).toMatchObject({
      ok: true,
      requestId: "req_cover_from_spoon_editorial_activate",
      data: {
        activeCover: expect.objectContaining({
          id: createdCoverId,
          activeVariant: "image",
        }),
        createdCover: expect.objectContaining({
          sourceType: "spoon",
          sourceSpoonId: fixture.spoon.id,
          status: "processing",
          generationStatus: "processing",
        }),
        generationStatus: "processing",
        mutation: { clientMutationId: "cover-from-spoon-editorial-activate", replayed: false },
      },
    });

    const syncResponse = await action(routeArgs(jsonRequest(createUrl, "POST", fixture.ownerKitchenWrite.token, "req_cover_from_spoon_sync_editorial", {
      clientMutationId: "cover-from-spoon-sync-editorial",
      activate: false,
      generateEditorial: true,
    }), createSplat));
    const syncPayload = await readJson(syncResponse);

    expect(syncResponse.status).toBe(201);
    expect(syncPayload).toMatchObject({
      ok: true,
      requestId: "req_cover_from_spoon_sync_editorial",
      data: {
        activeCover: expect.objectContaining({
          id: createdCoverId,
          activeVariant: "image",
        }),
        createdCover: expect.objectContaining({
          sourceType: "spoon",
          sourceSpoonId: fixture.spoon.id,
          status: "ready",
          generationStatus: "failed",
          failureReason: "missing_image_provider_config",
        }),
        generationStatus: "failed",
        mutation: { clientMutationId: "cover-from-spoon-sync-editorial", replayed: false },
      },
    });
  });

  it("returns not_found when creating covers from missing spoon photos", async () => {
    const fixture = await createCoverFixture(db);
    const missingSpoonId = "spoon_missing";
    const url = `http://localhost/api/v1/recipes/${fixture.recipe.id}/covers/from-spoon/${missingSpoonId}`;
    const response = await action(routeArgs(jsonRequest(url, "POST", fixture.ownerKitchenWrite.token, "req_cover_from_missing_spoon", {
      clientMutationId: "cover-from-missing-spoon",
    }), `recipes/${fixture.recipe.id}/covers/from-spoon/${missingSpoonId}`));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      requestId: "req_cover_from_missing_spoon",
      error: {
        code: "not_found",
        status: 404,
        details: { resource: "recipe_spoon", spoonId: missingSpoonId },
      },
    });
  });

  it("normalizes non-error cover mutation failures", async () => {
    const fixture = await createCoverFixture(db);
    vi.resetModules();
    vi.doMock("~/lib/recipe-cover.server", async (importOriginal) => ({
      ...(await importOriginal<typeof import("~/lib/recipe-cover.server")>()),
      setActiveRecipeCover: vi.fn(async () => {
        throw "plain cover failure";
      }),
    }));
    const { action: mockedAction } = await import("~/routes/api.v1.$");
    const url = `http://localhost/api/v1/recipes/${fixture.recipe.id}/covers/${fixture.replacementCover.id}`;
    const response = await mockedAction(routeArgs(jsonRequest(url, "PATCH", fixture.ownerKitchenWrite.token, "req_cover_plain_failure", {
      clientMutationId: "activate-plain-failure",
      variant: "image",
    }), `recipes/${fixture.recipe.id}/covers/${fixture.replacementCover.id}`));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      requestId: "req_cover_plain_failure",
      error: {
        code: "validation_error",
        status: 400,
        message: "Cover mutation failed",
      },
    });
  });
});
