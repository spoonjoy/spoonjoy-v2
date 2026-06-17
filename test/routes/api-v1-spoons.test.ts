import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import { action, loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import {
  hashIdempotencyRequest,
  idempotencyClientKey,
  reserveIdempotencyKey,
} from "~/lib/api-idempotency.server";
import { resolveApiV1ScopeRequirement } from "~/lib/api-v1.server";
import {
  nativeSpoonCreateIdempotencyBody,
  parseNativeSpoonCreateBody,
  parseNativeSpoonCreateRequest,
  parseNativeSpoonDeleteBody,
  parseNativeSpoonListUrl,
  parseNativeSpoonUpdateBody,
} from "~/lib/api-v1-spoons.server";
import { getLocalDb } from "~/lib/db.server";
import { IMAGE_MAX_FILE_SIZE } from "~/lib/recipe-image";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../utils";

type LocalDb = Awaited<ReturnType<typeof getLocalDb>>;
type MutationMethod = "POST" | "PATCH" | "DELETE";

const VALID_PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 1, 2, 3]);

function routeArgs(
  request: Request,
  splat: string,
  env: Record<string, unknown> | null = null,
  ctx?: { waitUntil?: (promise: Promise<unknown>) => void },
) {
  return {
    request,
    params: { "*": splat },
    context: { cloudflare: { env, ...(ctx ? { ctx } : {}) } },
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

function expectSpoonFailure(result: { ok: boolean; code?: string; details?: unknown }, code = "validation_error") {
  expect(result.ok).toBe(false);
  expect(result).toMatchObject({ code });
}

async function reserveSpoonMutation(db: LocalDb, input: {
  userId: string;
  credentialId: string;
  key: string;
  operation: string;
  method: MutationMethod;
  pathSuffix: string;
  body: Record<string, unknown>;
}) {
  const requestHash = await hashIdempotencyRequest({
    method: input.method,
    path: `/api/v1/${input.pathSuffix}`,
    body: input.body,
  });
  const reservation = await reserveIdempotencyKey(db, {
    userId: input.userId,
    credentialId: input.credentialId,
    clientKey: idempotencyClientKey({ id: input.userId, source: "bearer", credentialId: input.credentialId }),
    key: input.key,
    operation: input.operation,
    requestHash,
  });
  if (reservation.status !== "reserved") throw new Error(`expected reserved idempotency key, got ${reservation.status}`);
  return reservation.record;
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

  it("parses spoon contract edge cases for offline replay-stable native clients", async () => {
    expect(parseNativeSpoonListUrl(new URL("http://localhost/api/v1/recipes/recipe_1/spoons"))).toMatchObject({
      ok: true,
      data: { limit: 20, cursor: null },
    });
    expectSpoonFailure(parseNativeSpoonListUrl(new URL("http://localhost/api/v1/recipes/recipe_1/spoons?limit=0")));
    expectSpoonFailure(parseNativeSpoonListUrl(new URL("http://localhost/api/v1/recipes/recipe_1/spoons?cursor=plain")), "invalid_cursor");
    expectSpoonFailure(parseNativeSpoonListUrl(new URL("http://localhost/api/v1/recipes/recipe_1/spoons?cursor=v1.%25")), "invalid_cursor");
    const malformedCursor = `v1.${Buffer.from(JSON.stringify({ cookedAt: "not-a-date", id: "spoon_1" })).toString("base64url")}`;
    expectSpoonFailure(parseNativeSpoonListUrl(new URL(`http://localhost/api/v1/recipes/recipe_1/spoons?cursor=${malformedCursor}`)), "invalid_cursor");
    const arrayCursor = `v1.${Buffer.from(JSON.stringify([])).toString("base64url")}`;
    expectSpoonFailure(parseNativeSpoonListUrl(new URL(`http://localhost/api/v1/recipes/recipe_1/spoons?cursor=${arrayCursor}`)), "invalid_cursor");

    expectSpoonFailure(parseNativeSpoonCreateBody({ clientMutationId: "create-unknown", unexpected: true }));
    expectSpoonFailure(parseNativeSpoonCreateBody({ clientMutationId: "" }));
    expectSpoonFailure(parseNativeSpoonCreateBody({ clientMutationId: "create-bad-date", cookedAt: "" }));
    expectSpoonFailure(parseNativeSpoonCreateBody({ clientMutationId: "create-local-date", cookedAt: "2026-03-01T12:30:00" }));
    expectSpoonFailure(parseNativeSpoonCreateBody({ clientMutationId: "create-normalized-date", cookedAt: "2026-02-31T12:30:00.000Z" }));
    expectSpoonFailure(parseNativeSpoonCreateBody({ clientMutationId: "create-bad-offset", cookedAt: "2026-03-01T12:30:00+99:99" }));
    expectSpoonFailure(parseNativeSpoonCreateBody({ clientMutationId: "create-bad-month", cookedAt: "2026-13-01T12:30:00.000Z" }));
    expectSpoonFailure(parseNativeSpoonCreateBody({ clientMutationId: "create-bad-photo", photoUrl: 12 }));
    expectSpoonFailure(parseNativeSpoonCreateBody({ clientMutationId: "create-bad-cover", useAsRecipeCover: "true" }));
    expect(parseNativeSpoonCreateBody({
      clientMutationId: "create-normalized",
      note: "   ",
      nextTime: null,
      photoUrl: "   ",
      useAsRecipeCover: false,
    })).toMatchObject({
      ok: true,
      data: {
        clientMutationId: "create-normalized",
        note: null,
        nextTime: null,
        photoUrl: null,
        useAsRecipeCover: false,
      },
    });

    expectSpoonFailure(parseNativeSpoonUpdateBody({ clientMutationId: "update-unknown", unexpected: true }));
    expectSpoonFailure(parseNativeSpoonUpdateBody({ note: "missing mutation id" }));
    expectSpoonFailure(parseNativeSpoonUpdateBody({ clientMutationId: "update-bad-date", cookedAt: 7 }));
    expectSpoonFailure(parseNativeSpoonUpdateBody({ clientMutationId: "update-local-date", cookedAt: "2026-03-01T12:30:00" }));
    expectSpoonFailure(parseNativeSpoonUpdateBody({ clientMutationId: "update-normalized-date", cookedAt: "2026-02-31T12:30:00.000Z" }));
    expectSpoonFailure(parseNativeSpoonUpdateBody({ clientMutationId: "update-bad-photo", photoUrl: false }));

    expect(parseNativeSpoonDeleteBody({}, "delete-from-header")).toMatchObject({
      ok: true,
      data: { clientMutationId: "delete-from-header" },
    });
    expectSpoonFailure(parseNativeSpoonDeleteBody({ extra: true }, "delete-extra"));
    expectSpoonFailure(parseNativeSpoonDeleteBody({}, " "));

    const photoFile = new File([VALID_PNG_BYTES], "spoon.png", { type: "image/png" });
    expect(nativeSpoonCreateIdempotencyBody({
      clientMutationId: "create-with-file",
      photoFile,
      useAsRecipeCover: false,
    }).photo).toMatchObject({
      name: "spoon.png",
      type: "image/png",
      size: photoFile.size,
      sha256: null,
    });
    expect(nativeSpoonCreateIdempotencyBody({
      clientMutationId: "create-without-file",
      useAsRecipeCover: true,
    }).photo).toBeNull();
  });

  it("validates multipart spoon upload parser edge cases before mutation replay", async () => {
    const invalidJson = await parseNativeSpoonCreateRequest(new UndiciRequest("http://localhost/api/v1/recipes/recipe_1/spoons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    }) as unknown as Request);
    expectSpoonFailure(invalidJson);

    const invalidMultipart = await parseNativeSpoonCreateRequest(new UndiciRequest("http://localhost/api/v1/recipes/recipe_1/spoons", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=broken" },
      body: "not multipart",
    }) as unknown as Request);
    expectSpoonFailure(invalidMultipart);
    expect(invalidMultipart).toMatchObject({ details: { reason: "invalid_form_data" } });

    const noFileData = new UndiciFormData();
    noFileData.append("clientMutationId", "spoon-no-file");
    const noFile = await parseNativeSpoonCreateRequest(new UndiciRequest("http://localhost/api/v1/recipes/recipe_1/spoons", {
      method: "POST",
      body: noFileData,
    }) as unknown as Request);
    expectSpoonFailure(noFile);
    expect(noFile).toMatchObject({ details: { reason: "no_file" } });

    const noContentType = await parseNativeSpoonCreateRequest(new UndiciRequest("http://localhost/api/v1/recipes/recipe_1/spoons", {
      method: "POST",
    }) as unknown as Request);
    expectSpoonFailure(noContentType);

    const missingMutationId = new UndiciFormData();
    missingMutationId.append("photo", new File([VALID_PNG_BYTES], "spoon.png", { type: "image/png" }));
    expectSpoonFailure(await parseNativeSpoonCreateRequest(new UndiciRequest("http://localhost/api/v1/recipes/recipe_1/spoons", {
      method: "POST",
      body: missingMutationId,
    }) as unknown as Request));

    const invalidBoolean = new UndiciFormData();
    invalidBoolean.append("photo", new File([VALID_PNG_BYTES], "spoon.png", { type: "image/png" }));
    invalidBoolean.append("clientMutationId", "spoon-bad-cover-flag");
    invalidBoolean.append("useAsRecipeCover", "yes");
    expectSpoonFailure(await parseNativeSpoonCreateRequest(new UndiciRequest("http://localhost/api/v1/recipes/recipe_1/spoons", {
      method: "POST",
      body: invalidBoolean,
    }) as unknown as Request));

    const fileNote = new UndiciFormData();
    fileNote.append("photo", new File([VALID_PNG_BYTES], "spoon.png", { type: "image/png" }));
    fileNote.append("clientMutationId", "spoon-file-note");
    fileNote.append("note", new File(["not text"], "note.txt", { type: "text/plain" }));
    expectSpoonFailure(await parseNativeSpoonCreateRequest(new UndiciRequest("http://localhost/api/v1/recipes/recipe_1/spoons", {
      method: "POST",
      body: fileNote,
    }) as unknown as Request));

    const overlongNote = new UndiciFormData();
    overlongNote.append("photo", new File([VALID_PNG_BYTES], "spoon.png", { type: "image/png" }));
    overlongNote.append("clientMutationId", "spoon-long-note");
    overlongNote.append("note", "x".repeat(161));
    expectSpoonFailure(await parseNativeSpoonCreateRequest(new UndiciRequest("http://localhost/api/v1/recipes/recipe_1/spoons", {
      method: "POST",
      body: overlongNote,
    }) as unknown as Request));

    const fileNextTime = new UndiciFormData();
    fileNextTime.append("photo", new File([VALID_PNG_BYTES], "spoon.png", { type: "image/png" }));
    fileNextTime.append("clientMutationId", "spoon-file-next-time");
    fileNextTime.append("nextTime", new File(["not text"], "next-time.txt", { type: "text/plain" }));
    expectSpoonFailure(await parseNativeSpoonCreateRequest(new UndiciRequest("http://localhost/api/v1/recipes/recipe_1/spoons", {
      method: "POST",
      body: fileNextTime,
    }) as unknown as Request));

    const invalidDate = new UndiciFormData();
    invalidDate.append("photo", new File([VALID_PNG_BYTES], "spoon.png", { type: "image/png" }));
    invalidDate.append("clientMutationId", "spoon-bad-date");
    invalidDate.append("cookedAt", "not-a-date");
    expectSpoonFailure(await parseNativeSpoonCreateRequest(new UndiciRequest("http://localhost/api/v1/recipes/recipe_1/spoons", {
      method: "POST",
      body: invalidDate,
    }) as unknown as Request));

    const localDate = new UndiciFormData();
    localDate.append("photo", new File([VALID_PNG_BYTES], "spoon.png", { type: "image/png" }));
    localDate.append("clientMutationId", "spoon-local-date");
    localDate.append("cookedAt", "2026-06-01T10:00:00");
    expectSpoonFailure(await parseNativeSpoonCreateRequest(new UndiciRequest("http://localhost/api/v1/recipes/recipe_1/spoons", {
      method: "POST",
      body: localDate,
    }) as unknown as Request));

    const hugeFile = new UndiciFormData();
    hugeFile.append("photo", new File([VALID_PNG_BYTES, new Uint8Array(IMAGE_MAX_FILE_SIZE)], "huge.png", { type: "image/png" }));
    hugeFile.append("clientMutationId", "spoon-huge-file");
    const huge = await parseNativeSpoonCreateRequest(new UndiciRequest("http://localhost/api/v1/recipes/recipe_1/spoons", {
      method: "POST",
      body: hugeFile,
    }) as unknown as Request);
    expectSpoonFailure(huge);
    expect(huge).toMatchObject({ details: { reason: "file_too_large" } });

    const headerMutationId = new UndiciFormData();
    headerMutationId.append("photo", new File([VALID_PNG_BYTES], "spoon.png", { type: "image/png" }));
    headerMutationId.append("note", "   ");
    headerMutationId.append("nextTime", "  hotter pan  ");
    headerMutationId.append("cookedAt", "2026-06-01T10:00:00.000Z");
    headerMutationId.append("useAsRecipeCover", "false");
    expect(await parseNativeSpoonCreateRequest(new UndiciRequest("http://localhost/api/v1/recipes/recipe_1/spoons", {
      method: "POST",
      headers: { "X-Client-Mutation-Id": "spoon-header-id" },
      body: headerMutationId,
    }) as unknown as Request)).toMatchObject({
      ok: true,
      data: {
        clientMutationId: "spoon-header-id",
        note: null,
        nextTime: "hotter pan",
        useAsRecipeCover: false,
      },
    });
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

  it("rejects invalid spoon list filters and returns no-cover rows with null cover context", async () => {
    const { cook, recipe } = await createSpoonFixture(db);
    await db.recipeSpoon.create({
      data: {
        chefId: cook.id,
        recipeId: recipe.id,
        note: "no active cover",
      },
    });

    const invalidLimit = await loader(routeArgs(
      readRequest(`recipes/${recipe.id}/spoons?limit=abc`, "req_spoon_bad_limit"),
      `recipes/${recipe.id}/spoons`,
    ));
    expect(invalidLimit.status).toBe(400);
    expectErrorEnvelope(await readJson(invalidLimit), "req_spoon_bad_limit", "validation_error", 400);

    const missingRecipe = await loader(routeArgs(
      readRequest("recipes/missing-recipe/spoons", "req_spoon_missing_recipe"),
      "recipes/missing-recipe/spoons",
    ));
    expect(missingRecipe.status).toBe(404);
    expectErrorEnvelope(await readJson(missingRecipe), "req_spoon_missing_recipe", "not_found", 404);

    const noCover = await loader(routeArgs(
      readRequest(`recipes/${recipe.id}/spoons`, "req_spoon_no_cover"),
      `recipes/${recipe.id}/spoons`,
    ));
    const noCoverPayload = await readJson(noCover);
    expect(noCover.status).toBe(200);
    expect(noCoverPayload.data.spoons).toEqual([
      expect.objectContaining({
        note: "no active cover",
        coverImageUrl: null,
        coverProvenanceLabel: null,
        coverSourceType: null,
        coverVariant: null,
        coverStatus: null,
        coverGenerationStatus: null,
      }),
    ]);

    const stylizedCoverRecipe = await db.recipe.create({
      data: {
        ...createTestRecipe(cook.id),
        title: `API v1 Spoon Preferred Stylized ${faker.string.alphanumeric(8)}`,
        chefId: cook.id,
      },
    });
    const stylizedCover = await db.recipeCover.create({
      data: {
        recipeId: stylizedCoverRecipe.id,
        imageUrl: "/photos/covers/preferred-raw.jpg",
        stylizedImageUrl: "/photos/covers/preferred-stylized.jpg",
        sourceType: "spoon",
        status: "ready",
        generationStatus: "succeeded",
      },
    });
    await db.recipe.update({
      where: { id: stylizedCoverRecipe.id },
      data: { activeCoverId: stylizedCover.id, activeCoverVariant: null, coverMode: "manual" },
    });
    await db.recipeSpoon.create({
      data: {
        chefId: cook.id,
        recipeId: stylizedCoverRecipe.id,
        note: "preferred stylized cover",
      },
    });
    const stylizedCoverList = await loader(routeArgs(
      readRequest(`recipes/${stylizedCoverRecipe.id}/spoons`, "req_spoon_preferred_stylized_cover"),
      `recipes/${stylizedCoverRecipe.id}/spoons`,
    ));
    const stylizedCoverPayload = await readJson(stylizedCoverList);
    expect(stylizedCoverPayload.data.spoons[0]).toMatchObject({
      coverImageUrl: "/photos/covers/preferred-stylized.jpg",
      coverProvenanceLabel: "Editorialized chef photo",
      coverVariant: "stylized",
    });

    const emptyCoverRecipe = await db.recipe.create({
      data: {
        ...createTestRecipe(cook.id),
        title: `API v1 Spoon Empty Active Cover ${faker.string.alphanumeric(8)}`,
        chefId: cook.id,
      },
    });
    const emptyCover = await db.recipeCover.create({
      data: {
        recipeId: emptyCoverRecipe.id,
        imageUrl: "",
        stylizedImageUrl: null,
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "none",
      },
    });
    await db.recipe.update({
      where: { id: emptyCoverRecipe.id },
      data: { activeCoverId: emptyCover.id, activeCoverVariant: null, coverMode: "manual" },
    });
    await db.recipeSpoon.create({
      data: {
        chefId: cook.id,
        recipeId: emptyCoverRecipe.id,
        note: "empty active cover",
      },
    });
    const emptyCoverList = await loader(routeArgs(
      readRequest(`recipes/${emptyCoverRecipe.id}/spoons`, "req_spoon_empty_active_cover"),
      `recipes/${emptyCoverRecipe.id}/spoons`,
    ));
    const emptyCoverPayload = await readJson(emptyCoverList);
    expect(emptyCoverPayload.data.spoons[0]).toMatchObject({
      coverImageUrl: null,
      coverProvenanceLabel: null,
      coverVariant: null,
    });

    const archivedCoverRecipe = await db.recipe.create({
      data: {
        ...createTestRecipe(cook.id),
        title: `API v1 Spoon Archived Active Cover ${faker.string.alphanumeric(8)}`,
        chefId: cook.id,
      },
    });
    const archivedCover = await db.recipeCover.create({
      data: {
        recipeId: archivedCoverRecipe.id,
        imageUrl: "/photos/covers/archived-raw.jpg",
        sourceType: "spoon",
        status: "archived",
        generationStatus: "processing",
        archivedAt: new Date(),
      },
    });
    await db.recipe.update({
      where: { id: archivedCoverRecipe.id },
      data: { activeCoverId: archivedCover.id, activeCoverVariant: "image", coverMode: "manual" },
    });
    await db.recipeSpoon.create({
      data: {
        chefId: cook.id,
        recipeId: archivedCoverRecipe.id,
        note: "archived active cover",
      },
    });
    const archivedCoverList = await loader(routeArgs(
      readRequest(`recipes/${archivedCoverRecipe.id}/spoons`, "req_spoon_archived_active_cover"),
      `recipes/${archivedCoverRecipe.id}/spoons`,
    ));
    const archivedCoverPayload = await readJson(archivedCoverList);
    expect(archivedCoverPayload.data.spoons[0]).toMatchObject({
      coverImageUrl: null,
      coverProvenanceLabel: null,
      coverVariant: null,
      coverStatus: null,
      coverGenerationStatus: null,
    });
  });

  it("creates JSON cook logs with trimmed fields, cookedAt validation, idempotency metadata, and origin-owner notification flags", async () => {
    const { chef, chefWriter, cook, cookWriter, recipe } = await createSpoonFixture(db);
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
        spoonOnMyRecipe: "skipped",
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

    const noVapidResponse = await action(routeArgs(
      jsonMutationRequest("POST", `recipes/${recipe.id}/spoons`, cookWriter.token, "req_spoon_no_vapid_env", {
        clientMutationId: "native-spoon-no-vapid-env",
        note: "no notification config",
      }),
      `recipes/${recipe.id}/spoons`,
    ));
    const noVapidPayload = await readJson(noVapidResponse);
    expect(noVapidResponse.status).toBe(201);
    expect(noVapidPayload.data.notifications).toEqual({
      spoonOnMyRecipe: "unavailable",
      fellowChefOriginCook: "skipped",
    });

    const originResponse = await action(routeArgs(
      jsonMutationRequest("POST", `recipes/${recipe.id}/spoons`, chefWriter.token, "req_spoon_origin_no_fellows", {
        clientMutationId: "native-spoon-origin-no-fellows",
        note: "chef first cook without photo",
      }),
      `recipes/${recipe.id}/spoons`,
      vapidEnv,
    ));
    const originPayload = await readJson(originResponse);
    expect(originResponse.status).toBe(201);
    expect(originPayload.data).toMatchObject({
      isOriginCook: true,
      cover: null,
      notifications: {
        spoonOnMyRecipe: "skipped",
        fellowChefOriginCook: "skipped",
      },
    });
  });

  it("recovers committed incomplete spoon mutations for offline idempotent replay", async () => {
    const { chef, chefWriter, cook, cookWriter, recipe } = await createSpoonFixture(db);

    const createClientMutationId = "native-spoon-recover-create";
    const createPath = `recipes/${recipe.id}/spoons`;
    const createHashBody = {
      clientMutationId: createClientMutationId,
      note: "recovered origin spoon",
      nextTime: null,
      cookedAt: "2026-03-02T12:00:00.000Z",
      photoUrl: null,
      useAsRecipeCover: false,
    };
    const createReservation = await reserveSpoonMutation(db, {
      userId: chef.id,
      credentialId: chefWriter.credential.id,
      key: createClientMutationId,
      operation: "recipes.spoons.create",
      method: "POST",
      pathSuffix: createPath,
      body: createHashBody,
    });
    await db.recipeSpoon.create({
      data: {
        id: createReservation.id,
        chefId: chef.id,
        recipeId: recipe.id,
        note: "recovered origin spoon",
        cookedAt: new Date("2026-03-02T12:00:00.000Z"),
      },
    });

    const recoveredCreate = await action(routeArgs(
      jsonMutationRequest("POST", createPath, chefWriter.token, "req_spoon_recover_create", {
        clientMutationId: createClientMutationId,
        note: "recovered origin spoon",
        cookedAt: "2026-03-02T12:00:00.000Z",
      }),
      createPath,
    ));
    const recoveredCreatePayload = await readJson(recoveredCreate);
    expect(recoveredCreate.status).toBe(201);
    expectSuccessEnvelope(recoveredCreatePayload, "req_spoon_recover_create");
    expect(recoveredCreatePayload.data).toMatchObject({
      isOriginCook: true,
      spoon: { id: createReservation.id, chefId: chef.id, recipeId: recipe.id },
      notifications: { spoonOnMyRecipe: "skipped", fellowChefOriginCook: "skipped" },
      mutation: { clientMutationId: createClientMutationId, replayed: true },
    });
    await expect(db.recipeSpoon.count({ where: { chefId: chef.id, recipeId: recipe.id } })).resolves.toBe(1);

    const updateSpoon = await db.recipeSpoon.create({
      data: {
        chefId: cook.id,
        recipeId: recipe.id,
        note: "before recovery",
        nextTime: "later",
      },
    });
    const updateClientMutationId = "native-spoon-recover-update";
    const updatePath = `recipes/${recipe.id}/spoons/${updateSpoon.id}`;
    const updateHashBody = {
      clientMutationId: updateClientMutationId,
      note: "recovered update",
      nextTime: null,
      photoUrl: null,
    };
    await reserveSpoonMutation(db, {
      userId: cook.id,
      credentialId: cookWriter.credential.id,
      key: updateClientMutationId,
      operation: "recipes.spoons.update",
      method: "PATCH",
      pathSuffix: updatePath,
      body: updateHashBody,
    });
    await db.recipeSpoon.update({
      where: { id: updateSpoon.id },
      data: { note: "recovered update", nextTime: null, photoUrl: null },
    });

    const recoveredUpdate = await action(routeArgs(
      jsonMutationRequest("PATCH", updatePath, cookWriter.token, "req_spoon_recover_update", {
        clientMutationId: updateClientMutationId,
        note: "recovered update",
        nextTime: null,
        photoUrl: null,
      }),
      updatePath,
    ));
    const recoveredUpdatePayload = await readJson(recoveredUpdate);
    expect(recoveredUpdate.status).toBe(200);
    expectSuccessEnvelope(recoveredUpdatePayload, "req_spoon_recover_update");
    expect(recoveredUpdatePayload.data).toMatchObject({
      spoon: { id: updateSpoon.id, note: "recovered update", nextTime: null, photoUrl: null },
      mutation: { clientMutationId: updateClientMutationId, replayed: true },
    });

    const deleteSpoon = await db.recipeSpoon.create({
      data: {
        chefId: cook.id,
        recipeId: recipe.id,
        note: "delete recovery",
      },
    });
    const deleteClientMutationId = "native-spoon-recover-delete";
    const deletePath = `recipes/${recipe.id}/spoons/${deleteSpoon.id}`;
    const deleteReservation = await reserveSpoonMutation(db, {
      userId: cook.id,
      credentialId: cookWriter.credential.id,
      key: deleteClientMutationId,
      operation: "recipes.spoons.delete",
      method: "DELETE",
      pathSuffix: deletePath,
      body: { clientMutationId: deleteClientMutationId },
    });
    const deletedAt = new Date(deleteReservation.createdAt.getTime() + 1000);
    await db.recipeSpoon.update({
      where: { id: deleteSpoon.id },
      data: { deletedAt },
    });

    const recoveredDelete = await action(routeArgs(
      deleteRequest(deletePath, cookWriter.token, "req_spoon_recover_delete", deleteClientMutationId),
      deletePath,
    ));
    const recoveredDeletePayload = await readJson(recoveredDelete);
    expect(recoveredDelete.status).toBe(200);
    expectSuccessEnvelope(recoveredDeletePayload, "req_spoon_recover_delete");
    expect(recoveredDeletePayload.data).toMatchObject({
      deleted: true,
      spoon: { id: deleteSpoon.id, deletedAt: deletedAt.toISOString() },
      mutation: { clientMutationId: deleteClientMutationId, replayed: true },
    });
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
    const waitUntil = vi.fn();
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
      { ...vapidEnv, PHOTOS: bucket },
      { waitUntil },
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
        fellowChefOriginCook: "skipped",
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
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
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

    const missingRecipe = await action(routeArgs(
      jsonMutationRequest("POST", "recipes/missing-recipe/spoons", cookWriter.token, "req_spoon_create_missing_recipe", {
        clientMutationId: "native-spoon-missing-recipe",
        note: "lost recipe",
      }),
      "recipes/missing-recipe/spoons",
    ));
    expect(missingRecipe.status).toBe(404);
    expectErrorEnvelope(await readJson(missingRecipe), "req_spoon_create_missing_recipe", "not_found", 404);
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
    const { cook, cookWriter, recipe, otherRecipe, stranger, strangerWriter } = await createSpoonFixture(db);
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

    const noOpClientMutationId = "native-spoon-update-noop";
    const noOpUpdate = await action(routeArgs(
      jsonMutationRequest("PATCH", `recipes/${recipe.id}/spoons/${spoon.id}`, cookWriter.token, "req_spoon_update_noop", {
        clientMutationId: noOpClientMutationId,
      }),
      `recipes/${recipe.id}/spoons/${spoon.id}`,
    ));
    expect(noOpUpdate.status).toBe(200);
    expectSuccessEnvelope(await readJson(noOpUpdate), "req_spoon_update_noop");

    const omittedVersusClearConflict = await action(routeArgs(
      jsonMutationRequest("PATCH", `recipes/${recipe.id}/spoons/${spoon.id}`, cookWriter.token, "req_spoon_update_omitted_clear_conflict", {
        clientMutationId: noOpClientMutationId,
        photoUrl: null,
      }),
      `recipes/${recipe.id}/spoons/${spoon.id}`,
    ));
    expect(omittedVersusClearConflict.status).toBe(409);
    expectErrorEnvelope(await readJson(omittedVersusClearConflict), "req_spoon_update_omitted_clear_conflict", "idempotency_conflict", 409);

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

    const wrongOwnerPhoto = await action(routeArgs(
      jsonMutationRequest("PATCH", `recipes/${recipe.id}/spoons/${spoon.id}`, cookWriter.token, "req_spoon_update_wrong_owner_photo", {
        clientMutationId: "native-spoon-update-wrong-owner-photo",
        photoUrl: `/photos/spoons/${stranger.id}/updates/foreign.png`,
      }),
      `recipes/${recipe.id}/spoons/${spoon.id}`,
      { PHOTOS: bucket },
    ));
    expect(wrongOwnerPhoto.status).toBe(400);
    expectErrorEnvelope(await readJson(wrongOwnerPhoto), "req_spoon_update_wrong_owner_photo", "validation_error", 400);

    const clearsAllContent = await action(routeArgs(
      jsonMutationRequest("PATCH", `recipes/${recipe.id}/spoons/${spoon.id}`, cookWriter.token, "req_spoon_update_clears_content", {
        clientMutationId: "native-spoon-update-clears-content",
        note: null,
        nextTime: null,
        photoUrl: null,
      }),
      `recipes/${recipe.id}/spoons/${spoon.id}`,
    ));
    expect(clearsAllContent.status).toBe(400);
    expectErrorEnvelope(await readJson(clearsAllContent), "req_spoon_update_clears_content", "validation_error", 400);

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
