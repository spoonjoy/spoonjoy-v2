import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import { action, loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { resolveApiV1ScopeRequirement } from "~/lib/api-v1.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../utils";

type LocalDb = Awaited<ReturnType<typeof getLocalDb>>;
type MutationMethod = "POST" | "PATCH" | "DELETE";

const VALID_PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 1, 2, 3]);

function routeArgs(request: Request, splat: string, env: Record<string, unknown> | null = null) {
  return {
    request,
    params: { "*": splat },
    context: { cloudflare: { env } },
  } as never;
}

function bearerHeaders(token: string, requestId: string, extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Request-Id": requestId,
    ...extra,
  };
}

function readRequest(pathSuffix: string, requestId: string, token?: string) {
  return new UndiciRequest(`http://localhost/api/v1/${pathSuffix}`, {
    headers: token ? bearerHeaders(token, requestId) : { "X-Request-Id": requestId },
  }) as unknown as Request;
}

function jsonMutationRequest(
  method: MutationMethod,
  pathSuffix: string,
  token: string,
  requestId: string,
  body: unknown,
) {
  return new UndiciRequest(`http://localhost/api/v1/${pathSuffix}`, {
    method,
    headers: bearerHeaders(token, requestId, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  }) as unknown as Request;
}

function jsonMutationRequestWithoutAuth(method: MutationMethod, pathSuffix: string, requestId: string, body: unknown) {
  return new UndiciRequest(`http://localhost/api/v1/${pathSuffix}`, {
    method,
    headers: { "X-Request-Id": requestId, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Request;
}

function deleteRequest(pathSuffix: string, token: string, requestId: string, clientMutationId: string) {
  return new UndiciRequest(`http://localhost/api/v1/${pathSuffix}`, {
    method: "DELETE",
    headers: bearerHeaders(token, requestId, { "X-Client-Mutation-Id": clientMutationId }),
  }) as unknown as Request;
}

function multipartSpoonRequest(
  pathSuffix: string,
  token: string,
  requestId: string,
  clientMutationId: string,
  file: File,
  fields: Record<string, string> = {},
) {
  const formData = new UndiciFormData();
  formData.append("photo", file);
  formData.append("clientMutationId", clientMutationId);
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  return new UndiciRequest(`http://localhost/api/v1/${pathSuffix}`, {
    method: "POST",
    headers: bearerHeaders(token, requestId, {
      "X-Client-Mutation-Id": clientMutationId,
    }),
    body: formData,
  }) as unknown as Request;
}

async function readJson(response: Response) {
  return await response.json() as Record<string, any>;
}

function expectExactKeys(value: Record<string, unknown>, keys: string[]) {
  expect(Object.keys(value).sort()).toEqual([...keys].sort());
}

function expectBaseEnvelopeHeaders(response: Response, requestId: string) {
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(response.headers.get("X-Request-Id")).toBe(requestId);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type, X-Request-Id, X-Client-Mutation-Id");
  expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, PATCH, PUT, DELETE, OPTIONS");
}

function expectPublicEnvelopeHeaders(response: Response, requestId: string) {
  expectBaseEnvelopeHeaders(response, requestId);
  expect(response.headers.get("Cache-Control")).toBe("public, max-age=60, stale-while-revalidate=300");
  expect(response.headers.get("Vary")).toBe("Authorization, Cookie");
  expect(response.headers.get("Access-Control-Expose-Headers")).toContain("Cache-Control");
}

function expectPrivateEnvelopeHeaders(response: Response, requestId: string) {
  expectBaseEnvelopeHeaders(response, requestId);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Pragma")).toBe("no-cache");
  expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id, Retry-After");
}

function expectSuccessEnvelope(payload: Record<string, any>, requestId: string) {
  expectExactKeys(payload, ["data", "ok", "requestId"]);
  expect(payload.ok).toBe(true);
  expect(payload.requestId).toBe(requestId);
}

function expectErrorEnvelope(payload: Record<string, any>, requestId: string, code: string, status: number) {
  expectExactKeys(payload, ["error", "ok", "requestId"]);
  expect(payload.ok).toBe(false);
  expect(payload.requestId).toBe(requestId);
  expect(payload.error).toMatchObject({ code, status, message: expect.any(String) });
}

function expectMutationShape(mutation: Record<string, unknown>, clientMutationId: string, replayed: boolean) {
  expectExactKeys(mutation, ["clientMutationId", "replayed"]);
  expect(mutation).toEqual({ clientMutationId, replayed });
}

function expectSpoonShape(spoon: Record<string, any>) {
  expectExactKeys(spoon, [
    "chefId",
    "cookedAt",
    "createdAt",
    "deletedAt",
    "id",
    "nextTime",
    "note",
    "photoUrl",
    "recipeId",
    "updatedAt",
  ]);
  expect(typeof spoon.id).toBe("string");
  expect(typeof spoon.chefId).toBe("string");
  expect(typeof spoon.recipeId).toBe("string");
  expect(typeof spoon.cookedAt).toBe("string");
  expect(spoon.photoUrl === null || typeof spoon.photoUrl === "string").toBe(true);
  expect(spoon.note === null || typeof spoon.note === "string").toBe(true);
  expect(spoon.nextTime === null || typeof spoon.nextTime === "string").toBe(true);
  expect(spoon.deletedAt === null || typeof spoon.deletedAt === "string").toBe(true);
}

function expectListedSpoonShape(spoon: Record<string, any>) {
  expectExactKeys(spoon, [
    "chef",
    "chefId",
    "cookedAt",
    "coverGenerationStatus",
    "coverImageUrl",
    "coverProvenanceLabel",
    "coverSourceType",
    "coverStatus",
    "coverVariant",
    "createdAt",
    "deletedAt",
    "id",
    "nextTime",
    "note",
    "photoUrl",
    "recipeId",
    "updatedAt",
  ]);
  expectSpoonShape(Object.fromEntries(Object.entries(spoon).filter(([key]) => !key.startsWith("cover") && key !== "chef")));
  expectExactKeys(spoon.chef, ["id", "photoUrl", "username"]);
}

function expectCoverShape(cover: Record<string, any>) {
  expectExactKeys(cover, [
    "activeVariant",
    "archivedAt",
    "createdAt",
    "createdById",
    "displayUrl",
    "failureReason",
    "generationStatus",
    "id",
    "imageUrl",
    "provenanceLabel",
    "recipeId",
    "sourceImageUrl",
    "sourceSpoonId",
    "sourceType",
    "status",
    "stylizedImageUrl",
  ]);
  expect(cover.sourceType).toBe("spoon");
  expect(["processing", "ready", "failed", "archived"]).toContain(cover.status);
  expect(["none", "processing", "succeeded", "failed"]).toContain(cover.generationStatus);
}

function expectNotificationShape(notifications: Record<string, unknown>) {
  expectExactKeys(notifications, ["fellowChefOriginCook", "spoonOnMyRecipe"]);
  expect(["queued", "skipped", "unavailable"]).toContain(notifications.spoonOnMyRecipe);
  expect(["queued", "skipped", "unavailable"]).toContain(notifications.fellowChefOriginCook);
}

function expectCreateSpoonData(data: Record<string, any>, clientMutationId: string) {
  expectExactKeys(data, ["cover", "isOriginCook", "mutation", "notifications", "spoon"]);
  expectSpoonShape(data.spoon);
  if (data.cover) expectCoverShape(data.cover);
  expect(typeof data.isOriginCook).toBe("boolean");
  expectMutationShape(data.mutation, clientMutationId, false);
  expectNotificationShape(data.notifications);
}

function expectUpdateSpoonData(data: Record<string, any>, clientMutationId: string) {
  expectExactKeys(data, ["cover", "mutation", "spoon"]);
  expectSpoonShape(data.spoon);
  if (data.cover) expectCoverShape(data.cover);
  expectMutationShape(data.mutation, clientMutationId, false);
}

function expectDeleteSpoonData(data: Record<string, any>, clientMutationId: string) {
  expectExactKeys(data, ["deleted", "mutation", "spoon"]);
  expect(data.deleted).toBe(true);
  expectSpoonShape(data.spoon);
  expect(data.spoon.deletedAt).toEqual(expect.any(String));
  expectMutationShape(data.mutation, clientMutationId, false);
}

function mockPhotosBucket(existingKeys: string[] = []) {
  const stored = new Map<string, { value: unknown; httpMetadata?: { contentType?: string } }>();
  for (const key of existingKeys) {
    stored.set(key, { value: VALID_PNG_BYTES, httpMetadata: { contentType: "image/png" } });
  }

  const bucket = {
    put: vi.fn(async (key: string, value: unknown, options?: { httpMetadata?: { contentType?: string } }) => {
      stored.set(key, { value, httpMetadata: options?.httpMetadata });
      return {};
    }),
    get: vi.fn(async (key: string) => {
      const entry = stored.get(key);
      if (!entry) return null;
      return {
        httpMetadata: entry.httpMetadata,
        arrayBuffer: async () => {
          if (entry.value instanceof File) return entry.value.arrayBuffer();
          if (entry.value instanceof Uint8Array) {
            const bytes = entry.value;
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          }
          return new ArrayBuffer(0);
        },
      };
    }),
    delete: vi.fn(async (key: string) => {
      stored.delete(key);
    }),
    head: vi.fn(async (key: string) => stored.has(key) ? ({ key, httpMetadata: stored.get(key)?.httpMetadata }) : null),
    list: vi.fn(),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
  } as unknown as R2Bucket;

  return { bucket, stored };
}

const vapidEnv = {
  VAPID_PUBLIC_KEY: "test-public-key",
  VAPID_PRIVATE_KEY: "test-private-key",
  VAPID_SUBJECT: "mailto:test@spoonjoy.app",
};

async function createSpoonFixture(db: LocalDb) {
  const chef = await db.user.create({ data: createTestUser() });
  const cook = await db.user.create({ data: createTestUser() });
  const otherCook = await db.user.create({ data: createTestUser() });
  const stranger = await db.user.create({ data: createTestUser() });
  const recipe = await db.recipe.create({
    data: {
      ...createTestRecipe(chef.id),
      title: `API v1 Spoon Recipe ${faker.string.alphanumeric(8)}`,
      chefId: chef.id,
    },
  });
  const otherRecipe = await db.recipe.create({
    data: {
      ...createTestRecipe(chef.id),
      title: `API v1 Other Spoon Recipe ${faker.string.alphanumeric(8)}`,
      chefId: chef.id,
    },
  });
  const chefWriter = await createApiCredential(db, chef.id, "Spoon chef writer", { scopes: ["kitchen:write"] });
  const chefReader = await createApiCredential(db, chef.id, "Spoon chef reader", { scopes: ["recipes:read"] });
  const cookWriter = await createApiCredential(db, cook.id, "Spoon cook writer", { scopes: ["kitchen:write"] });
  const otherCookWriter = await createApiCredential(db, otherCook.id, "Spoon other cook writer", { scopes: ["kitchen:write"] });
  const strangerWriter = await createApiCredential(db, stranger.id, "Spoon stranger writer", { scopes: ["kitchen:write"] });
  const readOnly = await createApiCredential(db, cook.id, "Spoon read only", { scopes: ["recipes:read"] });

  return {
    chef,
    cook,
    otherCook,
    stranger,
    recipe,
    otherRecipe,
    chefWriter,
    chefReader,
    cookWriter,
    otherCookWriter,
    strangerWriter,
    readOnly,
  };
}

describe("API v1 recipe spoon endpoints", () => {
  let db: LocalDb;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("declares spoon routes with optional public reads and bearer write gates", async () => {
    const { recipe, readOnly } = await createSpoonFixture(db);

    expect(resolveApiV1ScopeRequirement("GET", `/api/v1/recipes/${recipe.id}/spoons`)).toEqual({
      auth: "optional",
      scopes: ["recipes:read"],
    });
    expect(resolveApiV1ScopeRequirement("POST", `/api/v1/recipes/${recipe.id}/spoons`)).toEqual({
      auth: "bearer",
      scopes: ["kitchen:write"],
    });
    expect(resolveApiV1ScopeRequirement("PATCH", `/api/v1/recipes/${recipe.id}/spoons/spoon_1`)).toEqual({
      auth: "bearer",
      scopes: ["kitchen:write"],
    });
    expect(resolveApiV1ScopeRequirement("DELETE", `/api/v1/recipes/${recipe.id}/spoons/spoon_1`)).toEqual({
      auth: "bearer",
      scopes: ["kitchen:write"],
    });

    const anonymousCreate = await action(routeArgs(
      jsonMutationRequestWithoutAuth("POST", `recipes/${recipe.id}/spoons`, "req_spoon_anon_create", {
        clientMutationId: "spoon-anon-create",
        note: "anonymous cook",
      }),
      `recipes/${recipe.id}/spoons`,
    ));
    expect(anonymousCreate.status).toBe(401);
    expectErrorEnvelope(await readJson(anonymousCreate), "req_spoon_anon_create", "authentication_required", 401);

    const readOnlyCreate = await action(routeArgs(
      jsonMutationRequest("POST", `recipes/${recipe.id}/spoons`, readOnly.token, "req_spoon_readonly_create", {
        clientMutationId: "spoon-readonly-create",
        note: "read-only cook",
      }),
      `recipes/${recipe.id}/spoons`,
    ));
    expect(readOnlyCreate.status).toBe(403);
    expectErrorEnvelope(await readJson(readOnlyCreate), "req_spoon_readonly_create", "insufficient_scope", 403);

    const invalidCollectionMethod = await action(routeArgs(
      new UndiciRequest(`http://localhost/api/v1/recipes/${recipe.id}/spoons`, {
        method: "PUT",
        headers: bearerHeaders(readOnly.token, "req_spoon_put_collection"),
      }) as unknown as Request,
      `recipes/${recipe.id}/spoons`,
    ));
    expect(invalidCollectionMethod.status).toBe(405);
    expect(invalidCollectionMethod.headers.get("Allow")).toBe("GET, POST");
  });

  it("lists recipe spoons with cursor pagination, deleted-row filtering, active cover context, and public/private cache behavior", async () => {
    const { chefReader, cook, otherCook, recipe } = await createSpoonFixture(db);
    const cover = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/covers/raw-spoon-list.jpg",
        stylizedImageUrl: "/photos/covers/editorial-spoon-list.jpg",
        sourceType: "spoon",
        status: "ready",
        generationStatus: "succeeded",
      },
    });
    await db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverId: cover.id, activeCoverVariant: "stylized", coverMode: "manual" },
    });
    await db.recipeSpoon.create({
      data: {
        chefId: cook.id,
        recipeId: recipe.id,
        note: "first public spoon",
        cookedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    await db.recipeSpoon.create({
      data: {
        chefId: otherCook.id,
        recipeId: recipe.id,
        note: "deleted public spoon",
        cookedAt: new Date("2026-01-15T00:00:00.000Z"),
        deletedAt: new Date("2026-01-16T00:00:00.000Z"),
      },
    });
    await db.recipeSpoon.create({
      data: {
        chefId: otherCook.id,
        recipeId: recipe.id,
        note: "second public spoon",
        cookedAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    });

    const firstPage = await loader(routeArgs(
      readRequest(`recipes/${recipe.id}/spoons?limit=1`, "req_spoon_list_public"),
      `recipes/${recipe.id}/spoons`,
    ));
    const firstPayload = await readJson(firstPage);

    expect(firstPage.status).toBe(200);
    expectPublicEnvelopeHeaders(firstPage, "req_spoon_list_public");
    expectSuccessEnvelope(firstPayload, "req_spoon_list_public");
    expectExactKeys(firstPayload.data, ["cursor", "hasMore", "limit", "nextCursor", "recipeId", "spoons"]);
    expect(firstPayload.data).toMatchObject({
      recipeId: recipe.id,
      limit: 1,
      cursor: null,
      hasMore: true,
      nextCursor: expect.stringMatching(/^v1\./),
    });
    expect(firstPayload.data.spoons).toHaveLength(1);
    expectListedSpoonShape(firstPayload.data.spoons[0]);
    expect(firstPayload.data.spoons[0]).toMatchObject({
      chefId: otherCook.id,
      note: "second public spoon",
      deletedAt: null,
      chef: { id: otherCook.id, username: otherCook.username, photoUrl: otherCook.photoUrl },
      coverImageUrl: "/photos/covers/editorial-spoon-list.jpg",
      coverProvenanceLabel: "Editorialized chef photo",
      coverSourceType: "spoon",
      coverVariant: "stylized",
      coverStatus: "ready",
      coverGenerationStatus: "succeeded",
    });

    const secondPage = await loader(routeArgs(
      readRequest(
        `recipes/${recipe.id}/spoons?limit=1&cursor=${encodeURIComponent(firstPayload.data.nextCursor)}`,
        "req_spoon_list_private",
        chefReader.token,
      ),
      `recipes/${recipe.id}/spoons`,
    ));
    const secondPayload = await readJson(secondPage);

    expect(secondPage.status).toBe(200);
    expectPrivateEnvelopeHeaders(secondPage, "req_spoon_list_private");
    expectSuccessEnvelope(secondPayload, "req_spoon_list_private");
    expect(secondPayload.data).toMatchObject({
      recipeId: recipe.id,
      limit: 1,
      cursor: firstPayload.data.nextCursor,
      nextCursor: null,
      hasMore: false,
    });
    expect(secondPayload.data.spoons).toHaveLength(1);
    expect(secondPayload.data.spoons[0]).toMatchObject({
      chefId: cook.id,
      note: "first public spoon",
      deletedAt: null,
    });
  });

  it("creates JSON cook logs with trimmed fields, cookedAt validation, idempotency metadata, and origin-owner notification flags", async () => {
    const { chef, cook, cookWriter, recipe } = await createSpoonFixture(db);
    const clientMutationId = "native-spoon-json-create";
    const response = await action(routeArgs(
      jsonMutationRequest("POST", `recipes/${recipe.id}/spoons`, cookWriter.token, "req_spoon_json_create", {
        clientMutationId,
        note: "  weeknight win  ",
        nextTime: "  add more lemon  ",
        cookedAt: "2026-03-01T12:30:00.000Z",
      }),
      `recipes/${recipe.id}/spoons`,
      vapidEnv,
    ));
    const payload = await readJson(response);

    expect(response.status).toBe(201);
    expectPrivateEnvelopeHeaders(response, "req_spoon_json_create");
    expectSuccessEnvelope(payload, "req_spoon_json_create");
    expectCreateSpoonData(payload.data, clientMutationId);
    expect(payload.data).toMatchObject({
      isOriginCook: false,
      cover: null,
      notifications: {
        spoonOnMyRecipe: "queued",
        fellowChefOriginCook: "skipped",
      },
      spoon: {
        chefId: cook.id,
        recipeId: recipe.id,
        note: "weeknight win",
        nextTime: "add more lemon",
        cookedAt: "2026-03-01T12:30:00.000Z",
        deletedAt: null,
      },
    });
    await expect(db.notificationEvent.findMany({
      where: { recipientId: chef.id, kind: "spoon_on_my_recipe" },
    })).resolves.toEqual([
      expect.objectContaining({
        payload: expect.stringContaining(cook.username),
      }),
    ]);
  });

  it("accepts uploaded spoon photos, auto-seeds owner origin covers, and ignores forged cover opt-ins from non-owners", async () => {
    const { bucket } = mockPhotosBucket();
    const { chef, chefWriter, cook, cookWriter, recipe } = await createSpoonFixture(db);
    const fellowRecipe = await db.recipe.create({
      data: {
        ...createTestRecipe(cook.id),
        title: `API v1 Spoon Fellow Recipe ${faker.string.alphanumeric(8)}`,
        chefId: cook.id,
      },
    });
    await db.recipeSpoon.create({
      data: {
        chefId: chef.id,
        recipeId: fellowRecipe.id,
        note: "prior cook that makes the recipe owner and cook fellow chefs",
      },
    });
    const ownerClientMutationId = "native-spoon-owner-photo";
    const ownerResponse = await action(routeArgs(
      multipartSpoonRequest(
        `recipes/${recipe.id}/spoons`,
        chefWriter.token,
        "req_spoon_owner_photo",
        ownerClientMutationId,
        new File([VALID_PNG_BYTES], "owner-spoon.png", { type: "image/png" }),
        { useAsRecipeCover: "false" },
      ),
      `recipes/${recipe.id}/spoons`,
      { PHOTOS: bucket },
    ));
    const ownerPayload = await readJson(ownerResponse);

    expect(ownerResponse.status).toBe(201);
    expectPrivateEnvelopeHeaders(ownerResponse, "req_spoon_owner_photo");
    expectSuccessEnvelope(ownerPayload, "req_spoon_owner_photo");
    expectCreateSpoonData(ownerPayload.data, ownerClientMutationId);
    expect(ownerPayload.data).toMatchObject({
      isOriginCook: true,
      notifications: {
        spoonOnMyRecipe: "skipped",
        fellowChefOriginCook: "queued",
      },
      spoon: {
        chefId: chef.id,
        recipeId: recipe.id,
        photoUrl: expect.stringMatching(new RegExp(`^/photos/spoons/${chef.id}/${recipe.id}/\\d+-[a-f0-9-]+\\.png$`)),
      },
      cover: {
        recipeId: recipe.id,
        sourceType: "spoon",
        sourceSpoonId: ownerPayload.data.spoon.id,
        sourceImageUrl: ownerPayload.data.spoon.photoUrl,
        imageUrl: ownerPayload.data.spoon.photoUrl,
        status: "processing",
        generationStatus: "processing",
        createdById: chef.id,
        activeVariant: null,
      },
    });
    expect(bucket.put).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^spoons/${chef.id}/${recipe.id}/\\d+-[a-f0-9-]+\\.png$`)),
      expect.any(File),
      { httpMetadata: { contentType: "image/png" } },
    );
    await expect(db.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
      select: { activeCoverId: true, activeCoverVariant: true, coverMode: true },
    })).resolves.toEqual({
      activeCoverId: ownerPayload.data.cover.id,
      activeCoverVariant: null,
      coverMode: "auto",
    });
    await expect(db.notificationEvent.findMany({
      where: { recipientId: cook.id, kind: "fellow_chef_origin_cook" },
    })).resolves.toEqual([
      expect.objectContaining({
        payload: expect.stringContaining(recipe.title),
      }),
    ]);

    const forgedResponse = await action(routeArgs(
      multipartSpoonRequest(
        `recipes/${recipe.id}/spoons`,
        cookWriter.token,
        "req_spoon_non_owner_cover_opt_in",
        "native-spoon-non-owner-photo",
        new File([VALID_PNG_BYTES], "guest-spoon.png", { type: "image/png" }),
        { useAsRecipeCover: "true" },
      ),
      `recipes/${recipe.id}/spoons`,
      { PHOTOS: bucket },
    ));
    const forgedPayload = await readJson(forgedResponse);
    expect(forgedResponse.status).toBe(201);
    expectSuccessEnvelope(forgedPayload, "req_spoon_non_owner_cover_opt_in");
    expectCreateSpoonData(forgedPayload.data, "native-spoon-non-owner-photo");
    expect(forgedPayload.data).toMatchObject({
      isOriginCook: false,
      cover: null,
      spoon: { chefId: cook.id, recipeId: recipe.id },
    });
    await expect(db.recipeCover.count({ where: { recipeId: recipe.id } })).resolves.toBe(1);
  });

  it("validates empty content, cookedAt, GIF uploads, and owner-owned photoUrl assignment", async () => {
    const { chef, chefWriter, cook, cookWriter, recipe } = await createSpoonFixture(db);
    const foreignKey = `spoons/${chef.id}/foreign-owner.png`;
    const { bucket } = mockPhotosBucket([foreignKey]);

    const empty = await action(routeArgs(
      jsonMutationRequest("POST", `recipes/${recipe.id}/spoons`, cookWriter.token, "req_spoon_empty", {
        clientMutationId: "native-spoon-empty",
      }),
      `recipes/${recipe.id}/spoons`,
    ));
    expect(empty.status).toBe(400);
    expectErrorEnvelope(await readJson(empty), "req_spoon_empty", "validation_error", 400);

    const badCookedAt = await action(routeArgs(
      jsonMutationRequest("POST", `recipes/${recipe.id}/spoons`, cookWriter.token, "req_spoon_bad_cooked_at", {
        clientMutationId: "native-spoon-bad-cooked-at",
        note: "date typo",
        cookedAt: "not a date",
      }),
      `recipes/${recipe.id}/spoons`,
    ));
    expect(badCookedAt.status).toBe(400);
    expectErrorEnvelope(await readJson(badCookedAt), "req_spoon_bad_cooked_at", "validation_error", 400);

    const gif = await action(routeArgs(
      multipartSpoonRequest(
        `recipes/${recipe.id}/spoons`,
        chefWriter.token,
        "req_spoon_gif",
        "native-spoon-gif",
        new File([GIF_BYTES], "spoon.png", { type: "image/png" }),
      ),
      `recipes/${recipe.id}/spoons`,
      { PHOTOS: bucket },
    ));
    expect(gif.status).toBe(400);
    expectErrorEnvelope(await readJson(gif), "req_spoon_gif", "validation_error", 400);

    const wrongOwnerPhoto = await action(routeArgs(
      jsonMutationRequest("POST", `recipes/${recipe.id}/spoons`, cookWriter.token, "req_spoon_wrong_owner_photo", {
        clientMutationId: "native-spoon-wrong-owner-photo",
        photoUrl: `/photos/${foreignKey}`,
      }),
      `recipes/${recipe.id}/spoons`,
      { PHOTOS: bucket },
    ));
    expect(wrongOwnerPhoto.status).toBe(400);
    expectErrorEnvelope(await readJson(wrongOwnerPhoto), "req_spoon_wrong_owner_photo", "validation_error", 400);
  });

  it("validates note and nextTime payload types and length on create and update", async () => {
    const { cook, cookWriter, recipe } = await createSpoonFixture(db);
    const overlong = "x".repeat(161);
    const existing = await db.recipeSpoon.create({
      data: {
        chefId: cook.id,
        recipeId: recipe.id,
        note: "editable",
      },
    });

    for (const [requestId, body] of [
      ["req_spoon_create_note_type", { clientMutationId: "native-spoon-create-note-type", note: 12 }],
      ["req_spoon_create_next_type", { clientMutationId: "native-spoon-create-next-type", nextTime: { text: "later" } }],
      ["req_spoon_create_note_long", { clientMutationId: "native-spoon-create-note-long", note: overlong }],
      ["req_spoon_create_next_long", { clientMutationId: "native-spoon-create-next-long", nextTime: overlong }],
    ] as const) {
      const response = await action(routeArgs(
        jsonMutationRequest("POST", `recipes/${recipe.id}/spoons`, cookWriter.token, requestId, body),
        `recipes/${recipe.id}/spoons`,
      ));
      expect(response.status).toBe(400);
      expectErrorEnvelope(await readJson(response), requestId, "validation_error", 400);
    }

    for (const [requestId, body] of [
      ["req_spoon_update_note_type", { clientMutationId: "native-spoon-update-note-type", note: false }],
      ["req_spoon_update_next_type", { clientMutationId: "native-spoon-update-next-type", nextTime: ["later"] }],
      ["req_spoon_update_note_long", { clientMutationId: "native-spoon-update-note-long", note: overlong }],
      ["req_spoon_update_next_long", { clientMutationId: "native-spoon-update-next-long", nextTime: overlong }],
    ] as const) {
      const response = await action(routeArgs(
        jsonMutationRequest("PATCH", `recipes/${recipe.id}/spoons/${existing.id}`, cookWriter.token, requestId, body),
        `recipes/${recipe.id}/spoons/${existing.id}`,
      ));
      expect(response.status).toBe(400);
      expectErrorEnvelope(await readJson(response), requestId, "validation_error", 400);
    }
  });

  it("updates and deletes only owned active spoons on the recipe path while excluding deleted spoons from reads", async () => {
    const { cook, cookWriter, recipe, otherRecipe, strangerWriter } = await createSpoonFixture(db);
    const photoKey = `spoons/${cook.id}/updates/final.png`;
    const { bucket } = mockPhotosBucket([photoKey]);
    const spoon = await db.recipeSpoon.create({
      data: {
        chefId: cook.id,
        recipeId: recipe.id,
        note: "first notes",
      },
    });

    const updateClientMutationId = "native-spoon-update";
    const update = await action(routeArgs(
      jsonMutationRequest("PATCH", `recipes/${recipe.id}/spoons/${spoon.id}`, cookWriter.token, "req_spoon_update", {
        clientMutationId: updateClientMutationId,
        note: null,
        nextTime: "use more cumin",
        photoUrl: `/photos/${photoKey}`,
        cookedAt: "2026-04-05T09:15:00.000Z",
      }),
      `recipes/${recipe.id}/spoons/${spoon.id}`,
      { PHOTOS: bucket },
    ));
    const updatePayload = await readJson(update);
    expect(update.status).toBe(200);
    expectPrivateEnvelopeHeaders(update, "req_spoon_update");
    expectSuccessEnvelope(updatePayload, "req_spoon_update");
    expectUpdateSpoonData(updatePayload.data, updateClientMutationId);
    expect(updatePayload.data).toMatchObject({
      cover: null,
      spoon: {
        id: spoon.id,
        chefId: cook.id,
        recipeId: recipe.id,
        note: null,
        nextTime: "use more cumin",
        photoUrl: `/photos/${photoKey}`,
        cookedAt: "2026-04-05T09:15:00.000Z",
      },
    });

    const pathMismatch = await action(routeArgs(
      jsonMutationRequest("PATCH", `recipes/${otherRecipe.id}/spoons/${spoon.id}`, cookWriter.token, "req_spoon_path_mismatch", {
        clientMutationId: "native-spoon-path-mismatch",
        note: "wrong recipe path",
      }),
      `recipes/${otherRecipe.id}/spoons/${spoon.id}`,
    ));
    expect(pathMismatch.status).toBe(404);
    expectErrorEnvelope(await readJson(pathMismatch), "req_spoon_path_mismatch", "not_found", 404);

    const strangerUpdate = await action(routeArgs(
      jsonMutationRequest("PATCH", `recipes/${recipe.id}/spoons/${spoon.id}`, strangerWriter.token, "req_spoon_stranger_update", {
        clientMutationId: "native-spoon-stranger-update",
        note: "hijack",
      }),
      `recipes/${recipe.id}/spoons/${spoon.id}`,
    ));
    expect(strangerUpdate.status).toBe(403);
    expectErrorEnvelope(await readJson(strangerUpdate), "req_spoon_stranger_update", "insufficient_scope", 403);

    const deletePathMismatch = await action(routeArgs(
      deleteRequest(`recipes/${otherRecipe.id}/spoons/${spoon.id}`, cookWriter.token, "req_spoon_delete_path_mismatch", "native-spoon-delete-path-mismatch"),
      `recipes/${otherRecipe.id}/spoons/${spoon.id}`,
    ));
    expect(deletePathMismatch.status).toBe(404);
    expectErrorEnvelope(await readJson(deletePathMismatch), "req_spoon_delete_path_mismatch", "not_found", 404);

    const strangerDelete = await action(routeArgs(
      deleteRequest(`recipes/${recipe.id}/spoons/${spoon.id}`, strangerWriter.token, "req_spoon_stranger_delete", "native-spoon-stranger-delete"),
      `recipes/${recipe.id}/spoons/${spoon.id}`,
    ));
    expect(strangerDelete.status).toBe(403);
    expectErrorEnvelope(await readJson(strangerDelete), "req_spoon_stranger_delete", "insufficient_scope", 403);

    const deleteClientMutationId = "native-spoon-delete";
    const deleted = await action(routeArgs(
      deleteRequest(`recipes/${recipe.id}/spoons/${spoon.id}`, cookWriter.token, "req_spoon_delete", deleteClientMutationId),
      `recipes/${recipe.id}/spoons/${spoon.id}`,
    ));
    const deletePayload = await readJson(deleted);
    expect(deleted.status).toBe(200);
    expectPrivateEnvelopeHeaders(deleted, "req_spoon_delete");
    expectSuccessEnvelope(deletePayload, "req_spoon_delete");
    expectDeleteSpoonData(deletePayload.data, deleteClientMutationId);

    const afterDelete = await loader(routeArgs(
      readRequest(`recipes/${recipe.id}/spoons`, "req_spoon_list_after_delete"),
      `recipes/${recipe.id}/spoons`,
    ));
    const afterDeletePayload = await readJson(afterDelete);
    expect(afterDelete.status).toBe(200);
    expect(afterDeletePayload.data.spoons).toEqual([]);

    const updateDeleted = await action(routeArgs(
      jsonMutationRequest("PATCH", `recipes/${recipe.id}/spoons/${spoon.id}`, cookWriter.token, "req_spoon_update_deleted", {
        clientMutationId: "native-spoon-update-deleted",
        note: "too late",
      }),
      `recipes/${recipe.id}/spoons/${spoon.id}`,
    ));
    expect(updateDeleted.status).toBe(404);
    expectErrorEnvelope(await readJson(updateDeleted), "req_spoon_update_deleted", "not_found", 404);
  });

  it("lets a deleted prior owner spoon reopen origin-cook cover seeding", async () => {
    const { bucket } = mockPhotosBucket();
    const { chef, chefWriter, recipe } = await createSpoonFixture(db);
    await db.recipeSpoon.create({
      data: {
        chefId: chef.id,
        recipeId: recipe.id,
        note: "deleted first cook",
        deletedAt: new Date("2026-05-01T00:00:00.000Z"),
      },
    });

    const clientMutationId = "native-spoon-origin-after-delete";
    const response = await action(routeArgs(
      multipartSpoonRequest(
        `recipes/${recipe.id}/spoons`,
        chefWriter.token,
        "req_spoon_origin_after_delete",
        clientMutationId,
        new File([VALID_PNG_BYTES], "origin-again.png", { type: "image/png" }),
      ),
      `recipes/${recipe.id}/spoons`,
      { PHOTOS: bucket },
    ));
    const payload = await readJson(response);

    expect(response.status).toBe(201);
    expectSuccessEnvelope(payload, "req_spoon_origin_after_delete");
    expectCreateSpoonData(payload.data, clientMutationId);
    expect(payload.data).toMatchObject({
      isOriginCook: true,
      spoon: {
        chefId: chef.id,
        recipeId: recipe.id,
        deletedAt: null,
      },
      cover: {
        sourceType: "spoon",
        sourceSpoonId: payload.data.spoon.id,
        createdById: chef.id,
      },
    });
    await expect(db.recipeCover.count({ where: { recipeId: recipe.id, sourceSpoonId: payload.data.spoon.id } })).resolves.toBe(1);
  });
});
