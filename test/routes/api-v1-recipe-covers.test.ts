import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import { action, loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { hashIdempotencyRequest } from "~/lib/api-idempotency.server";
import { resolveApiV1ScopeRequirement } from "~/lib/api-v1.server";
import { getLocalDb } from "~/lib/db.server";
import { IMAGE_MAX_FILE_SIZE } from "~/lib/recipe-image";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../utils";

type LocalDb = Awaited<ReturnType<typeof getLocalDb>>;
type MutationMethod = "POST" | "PATCH" | "DELETE";

const VALID_PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 1, 2, 3]);

function b64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

function dataUrl(bytes = VALID_PNG_BYTES) {
  return `data:image/png;base64,${b64(bytes)}`;
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Buffer.from(digest).toString("hex");
}

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

function getRequest(pathSuffix: string, token: string, requestId: string) {
  return new UndiciRequest(`http://localhost/api/v1/${pathSuffix}`, {
    headers: bearerHeaders(token, requestId),
  }) as unknown as Request;
}

function getRequestWithoutAuth(pathSuffix: string, requestId: string) {
  return new UndiciRequest(`http://localhost/api/v1/${pathSuffix}`, {
    headers: { "X-Request-Id": requestId },
  }) as unknown as Request;
}

function multipartImageRequest(
  pathSuffix: string,
  token: string,
  requestId: string,
  clientMutationId: string,
  file: File,
  fields: Record<string, string> = {},
) {
  const formData = new UndiciFormData();
  formData.append("image", file);
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

function expectSuccessEnvelope(payload: Record<string, any>, requestId: string) {
  expectExactKeys(payload, ["ok", "requestId", "data"]);
  expect(payload.ok).toBe(true);
  expect(payload.requestId).toBe(requestId);
}

function expectErrorEnvelope(
  payload: Record<string, any>,
  requestId: string,
  code: string,
  status: number,
  withDetails = false,
) {
  expectExactKeys(payload, ["ok", "requestId", "error"]);
  expect(payload.ok).toBe(false);
  expect(payload.requestId).toBe(requestId);
  expect(Object.keys(payload.error).sort()).toEqual(withDetails
    ? ["code", "details", "message", "status"]
    : ["code", "message", "status"]);
  expect(payload.error).toMatchObject({ code, status, message: expect.any(String) });
}

function expectMutationShape(mutation: Record<string, unknown>, clientMutationId: string, replayed: boolean) {
  expectExactKeys(mutation, ["clientMutationId", "replayed"]);
  expect(mutation).toEqual({ clientMutationId, replayed });
}

function expectProviderBlockerShape(blocker: Record<string, unknown>, outputPath: string) {
  expectExactKeys(blocker, [
    "blocked",
    "capability",
    "command",
    "domain",
    "outputPath",
    "ownerAction",
    "reason",
  ]);
  expect(blocker).toMatchObject({
    blocked: true,
    capability: "ProviderSecret",
    domain: "recipe-covers",
    outputPath,
    ownerAction: expect.stringMatching(/OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY/),
    reason: expect.stringMatching(/image provider|provider secret|OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY/i),
  });
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
  expect(typeof cover.id).toBe("string");
  expect(typeof cover.recipeId).toBe("string");
  expect(typeof cover.imageUrl).toBe("string");
  expect(cover.stylizedImageUrl === null || typeof cover.stylizedImageUrl === "string").toBe(true);
  expect(["ai-placeholder", "import", "chef-upload", "spoon"]).toContain(cover.sourceType);
  expect(["processing", "ready", "failed", "archived"]).toContain(cover.status);
  expect(["none", "processing", "succeeded", "failed"]).toContain(cover.generationStatus);
  expect(cover.activeVariant === null || cover.activeVariant === "image" || cover.activeVariant === "stylized").toBe(true);
  expect(cover.displayUrl === null || typeof cover.displayUrl === "string").toBe(true);
}

function expectSpoonImageShape(spoonImage: Record<string, any>) {
  expectExactKeys(spoonImage, [
    "chef",
    "chefId",
    "cookedAt",
    "createdAt",
    "id",
    "photoUrl",
    "recipeId",
    "updatedAt",
  ]);
  expect(typeof spoonImage.id).toBe("string");
  expect(typeof spoonImage.photoUrl).toBe("string");
  expectExactKeys(spoonImage.chef, ["id", "photoUrl", "username"]);
}

function expectCoverMutationData(
  data: Record<string, any>,
  clientMutationId: string,
  replayed: boolean,
  options: { created: boolean; blockers?: boolean } = { created: true },
) {
  expectExactKeys(data, [
    "activeCover",
    "blockers",
    "createdCover",
    "generationStatus",
    "mutation",
    "nextActions",
    "previousActiveCover",
    "warnings",
  ]);
  if (options.created) {
    expectCoverShape(data.createdCover);
  } else {
    expect(data.createdCover).toBeNull();
  }
  if (data.activeCover) expectCoverShape(data.activeCover);
  if (data.previousActiveCover) expectCoverShape(data.previousActiveCover);
    expect(Array.isArray(data.warnings)).toBe(true);
    expect(Array.isArray(data.nextActions)).toBe(true);
    expect(Array.isArray(data.blockers)).toBe(true);
    if (options.blockers) {
      expect(data.blockers).not.toEqual([]);
    } else {
      expect(data.blockers).toEqual([]);
    }
    expectMutationShape(data.mutation, clientMutationId, replayed);
  }

function expectActiveCoverMutationData(data: Record<string, any>, clientMutationId: string, replayed: boolean) {
  expectExactKeys(data, [
    "activeCover",
    "archivedCover",
    "blockers",
    "mutation",
    "nextActions",
    "previousActiveCover",
    "warnings",
  ]);
  if (data.activeCover) expectCoverShape(data.activeCover);
  if (data.previousActiveCover) expectCoverShape(data.previousActiveCover);
  if (data.archivedCover) expectCoverShape(data.archivedCover);
  expect(Array.isArray(data.warnings)).toBe(true);
  expect(Array.isArray(data.nextActions)).toBe(true);
  expect(data.blockers).toEqual([]);
  expectMutationShape(data.mutation, clientMutationId, replayed);
}

function createMemoryPhotosBucket(initialKeys: string[] = []) {
  const stored = new Map<string, { value: unknown; options?: unknown }>();
  for (const key of initialKeys) {
    stored.set(key, { value: new Uint8Array(VALID_PNG_BYTES), options: { httpMetadata: { contentType: "image/png" } } });
  }
  const puts: Array<{ key: string; value: unknown; options: unknown }> = [];
  const deletes: string[] = [];
  return {
    puts,
    deletes,
    bucket: {
      get: vi.fn(async (key: string) => stored.get(key) ?? null),
      put: vi.fn(async (key: string, value: unknown, options?: unknown) => {
        puts.push({ key, value, options });
        stored.set(key, { value, options });
        return null;
      }),
      delete: vi.fn(async (key: string) => {
        deletes.push(key);
        stored.delete(key);
      }),
    },
  };
}

async function createCoverFixture(db: LocalDb) {
  const chef = await db.user.create({ data: createTestUser() });
  const otherChef = await db.user.create({ data: createTestUser() });
  const writer = await createApiCredential(db, chef.id, "Cover writer", { scopes: ["kitchen:write"] });
  const reader = await createApiCredential(db, chef.id, "Cover reader", { scopes: ["recipes:read"] });
  const otherWriter = await createApiCredential(db, otherChef.id, "Other cover writer", { scopes: ["kitchen:write"] });
  const recipe = await db.recipe.create({
    data: {
      ...createTestRecipe(chef.id),
      title: `API Cover Recipe ${faker.string.alphanumeric(8)}`,
      description: "Recipe for native cover API tests",
      chefId: chef.id,
    },
  });
  return { chef, otherChef, writer, reader, otherWriter, recipe };
}

async function seedInFlightCoverMutation(
  db: LocalDb,
  input: {
    chefId: string;
    credentialId?: string | null;
    clientMutationId: string;
    operation: string;
    method: string;
    pathSuffix: string;
    body: unknown;
    coverId?: string;
    recipeId: string;
    payload?: unknown;
  },
) {
  const reservation = await db.apiIdempotencyKey.create({
    data: {
      userId: input.chefId,
      credentialId: input.credentialId ?? null,
      clientKey: `chef:${input.chefId}`,
      key: input.clientMutationId,
      operation: input.operation,
      requestHash: await hashIdempotencyRequest({
        method: input.method,
        path: `/api/v1/${input.pathSuffix}`,
        body: input.body,
      }),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const coverId = input.coverId ?? reservation.id;
  await db.apiMutationTombstone.create({
    data: {
      idempotencyKeyId: reservation.id,
      operation: input.operation,
      resourceType: "recipe_cover",
      resourceId: coverId,
      parentResourceId: input.recipeId,
      payload: JSON.stringify(input.payload ?? { previousActiveCover: null }),
    },
  });
  return reservation;
}

function artifactRoot() {
  return process.env.ARTIFACT_ROOT || path.join(tmpdir(), "spoonjoy-api-v1-recipe-covers-artifacts");
}

function providerBlockerPath() {
  return path.join(artifactRoot(), "web", "provider-secret-blocker-recipe-covers.json");
}

describe("API v1 recipe image and cover lifecycle endpoints", () => {
  let db: LocalDb;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    await mkdir(path.join(artifactRoot(), "web"), { recursive: true });
    await rm(providerBlockerPath(), { force: true });
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("declares the whole cover family as bearer kitchen-write routes and enforces auth before lifecycle access", async () => {
    const { writer, reader, recipe } = await createCoverFixture(db);
    const endpoints = [
      ["POST", `/api/v1/recipes/${recipe.id}/image`],
      ["GET", `/api/v1/recipes/${recipe.id}/covers`],
      ["POST", `/api/v1/recipes/${recipe.id}/covers`],
      ["PATCH", `/api/v1/recipes/${recipe.id}/covers/cover_1`],
      ["DELETE", `/api/v1/recipes/${recipe.id}/covers/cover_1`],
      ["POST", `/api/v1/recipes/${recipe.id}/covers/regenerate`],
      ["POST", `/api/v1/recipes/${recipe.id}/covers/from-spoon/spoon_1`],
    ] as const;

    for (const [method, endpoint] of endpoints) {
      expect(resolveApiV1ScopeRequirement(method, endpoint)).toEqual({
        auth: "bearer",
        scopes: ["kitchen:write"],
      });
    }

    const anonymous = await loader(routeArgs(
      getRequestWithoutAuth(`recipes/${recipe.id}/covers`, "req_covers_anon"),
      `recipes/${recipe.id}/covers`,
    ));
    expect(anonymous.status).toBe(401);
    expectErrorEnvelope(await readJson(anonymous), "req_covers_anon", "authentication_required", 401);

    const readOnly = await action(routeArgs(
      jsonMutationRequest(
        "POST",
        `recipes/${recipe.id}/covers`,
        reader.token,
        "req_covers_read_only",
        {
          clientMutationId: "cover-readonly-denied",
          imageUrl: "/photos/recipes/owner/uploads/raw.png",
        },
      ),
      `recipes/${recipe.id}/covers`,
    ));
    expect(readOnly.status).toBe(403);
    expectErrorEnvelope(await readJson(readOnly), "req_covers_read_only", "insufficient_scope", 403);

    const invalidMethod = await action(routeArgs(
      new UndiciRequest(`http://localhost/api/v1/recipes/${recipe.id}/covers`, {
        method: "PUT",
        headers: bearerHeaders(writer.token, "req_covers_put"),
      }) as unknown as Request,
      `recipes/${recipe.id}/covers`,
    ));
    expect(invalidMethod.status).toBe(405);
    expect(invalidMethod.headers.get("Allow")).toBe("GET, POST");
  });

  it("lists owner cover history, active state, archived rows, and available spoon photo sources", async () => {
    const { chef, otherChef, writer, otherWriter, recipe } = await createCoverFixture(db);
    const active = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/recipes/owner/raw-active.jpg",
        stylizedImageUrl: "/photos/recipes/owner/editorial-active.jpg",
        sourceType: "chef-upload",
        sourceImageUrl: "/photos/recipes/owner/raw-active.jpg",
        status: "ready",
        generationStatus: "succeeded",
        createdById: chef.id,
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
      },
    });
    const spoon = await db.recipeSpoon.create({
      data: {
        recipeId: recipe.id,
        chefId: otherChef.id,
        photoUrl: "/photos/spoons/other/source.jpg",
        cookedAt: new Date("2026-01-04T00:00:00.000Z"),
      },
    });
    const processing = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: spoon.photoUrl!,
        sourceType: "spoon",
        sourceSpoonId: spoon.id,
        sourceImageUrl: spoon.photoUrl!,
        status: "processing",
        generationStatus: "processing",
        createdById: chef.id,
        createdAt: new Date("2026-01-04T00:00:00.000Z"),
      },
    });
    const archived = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/recipes/owner/archived.jpg",
        sourceType: "import",
        status: "archived",
        generationStatus: "none",
        archivedAt: new Date("2026-01-02T00:00:00.000Z"),
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    });
    const placeholder = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/recipes/owner/ai-placeholder.jpg",
        sourceType: "ai-placeholder",
        status: "ready",
        generationStatus: "succeeded",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    await db.recipeSpoon.create({
      data: {
        recipeId: recipe.id,
        chefId: chef.id,
        photoUrl: null,
      },
    });
    await db.recipe.update({
      where: { id: recipe.id },
      data: {
        activeCoverId: active.id,
        activeCoverVariant: "stylized",
        coverMode: "manual",
      },
    });

    const response = await loader(routeArgs(
      getRequest(`recipes/${recipe.id}/covers?includeArchived=true&limit=10`, writer.token, "req_cover_history"),
      `recipes/${recipe.id}/covers`,
    ));
    const payload = await readJson(response);

    expect(response.status).toBe(200);
    expectPrivateEnvelopeHeaders(response, "req_cover_history");
    expectSuccessEnvelope(payload, "req_cover_history");
    expectExactKeys(payload.data, ["activeCover", "covers", "pagination", "spoonImages"]);
    expect(payload.data.covers).toHaveLength(4);
    expect(payload.data.covers.map((cover: Record<string, unknown>) => cover.id)).toEqual([
      processing.id,
      active.id,
      archived.id,
      placeholder.id,
    ]);
    for (const cover of payload.data.covers) expectCoverShape(cover);
    expect(payload.data.activeCover).toMatchObject({
      id: active.id,
      activeVariant: "stylized",
      displayUrl: "/photos/recipes/owner/editorial-active.jpg",
      provenanceLabel: "Editorialized chef photo",
    });
    expect(payload.data.covers.find((cover: Record<string, unknown>) => cover.id === archived.id)).toMatchObject({
      status: "archived",
      archivedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(payload.data.covers.find((cover: Record<string, unknown>) => cover.id === placeholder.id)).toMatchObject({
      sourceType: "ai-placeholder",
      imageUrl: "/photos/recipes/owner/ai-placeholder.jpg",
      displayUrl: "/photos/recipes/owner/ai-placeholder.jpg",
      activeVariant: null,
      provenanceLabel: "AI generated",
      status: "ready",
      generationStatus: "succeeded",
    });
    expect(payload.data.spoonImages).toHaveLength(1);
    expectSpoonImageShape(payload.data.spoonImages[0]);
    expect(payload.data.spoonImages[0]).toMatchObject({
      id: spoon.id,
      recipeId: recipe.id,
      chefId: otherChef.id,
      photoUrl: "/photos/spoons/other/source.jpg",
      chef: { id: otherChef.id, username: otherChef.username },
    });
    expect(payload.data.pagination).toEqual({ limit: 10, offset: 0, count: 4, hasMore: false });

    const foreign = await loader(routeArgs(
      getRequest(`recipes/${recipe.id}/covers`, otherWriter.token, "req_cover_history_foreign"),
      `recipes/${recipe.id}/covers`,
    ));
    expect(foreign.status).toBe(403);
    expectErrorEnvelope(await readJson(foreign), "req_cover_history_foreign", "insufficient_scope", 403);
  });

  it("rejects foreign writer cover mutations before storage, cover, or active-state side effects", async () => {
    const { chef, otherChef, otherWriter, recipe } = await createCoverFixture(db);
    const active = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/recipes/owner/active.jpg",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "none",
        createdById: chef.id,
      },
    });
    const inactive = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/recipes/owner/inactive.jpg",
        stylizedImageUrl: "/photos/recipes/owner/inactive-editorial.jpg",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "succeeded",
        createdById: chef.id,
      },
    });
    const spoon = await db.recipeSpoon.create({
      data: {
        recipeId: recipe.id,
        chefId: otherChef.id,
        photoUrl: "/photos/spoons/other/foreign-denied-source.jpg",
      },
    });
    await db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverId: active.id, activeCoverVariant: "image", coverMode: "manual" },
    });
    const imageKey = `recipes/${chef.id}/uploads/foreign-denied.png`;
    const photos = createMemoryPhotosBucket([imageKey]);

    const attempts = [
      [
        "req_cover_foreign_image_upload",
        () => action(routeArgs(
          multipartImageRequest(
            `recipes/${recipe.id}/image`,
            otherWriter.token,
            "req_cover_foreign_image_upload",
            "native-foreign-image-upload",
            new File([VALID_PNG_BYTES], "cover.png", { type: "image/png" }),
            { activate: "true", generateEditorial: "false" },
          ),
          `recipes/${recipe.id}/image`,
          { PHOTOS: photos.bucket },
        )),
      ],
      [
        "req_cover_foreign_create_url",
        () => action(routeArgs(
          jsonMutationRequest("POST", `recipes/${recipe.id}/covers`, otherWriter.token, "req_cover_foreign_create_url", {
            clientMutationId: "native-foreign-create-cover-url",
            imageUrl: `/photos/${imageKey}`,
            activate: true,
            generateEditorial: false,
          }),
          `recipes/${recipe.id}/covers`,
          { PHOTOS: photos.bucket },
        )),
      ],
      [
        "req_cover_foreign_activate",
        () => action(routeArgs(
          jsonMutationRequest("PATCH", `recipes/${recipe.id}/covers/${inactive.id}`, otherWriter.token, "req_cover_foreign_activate", {
            clientMutationId: "native-foreign-activate-cover",
            variant: "stylized",
          }),
          `recipes/${recipe.id}/covers/${inactive.id}`,
        )),
      ],
      [
        "req_cover_foreign_archive",
        () => action(routeArgs(
          jsonMutationRequest("DELETE", `recipes/${recipe.id}/covers/${inactive.id}`, otherWriter.token, "req_cover_foreign_archive", {
            clientMutationId: "native-foreign-archive-cover",
          }),
          `recipes/${recipe.id}/covers/${inactive.id}`,
        )),
      ],
      [
        "req_cover_foreign_regenerate",
        () => action(routeArgs(
          jsonMutationRequest("POST", `recipes/${recipe.id}/covers/regenerate`, otherWriter.token, "req_cover_foreign_regenerate", {
            clientMutationId: "native-foreign-regenerate-cover",
            coverId: inactive.id,
            activateWhenReady: true,
          }),
          `recipes/${recipe.id}/covers/regenerate`,
        )),
      ],
      [
        "req_cover_foreign_from_spoon",
        () => action(routeArgs(
          jsonMutationRequest("POST", `recipes/${recipe.id}/covers/from-spoon/${spoon.id}`, otherWriter.token, "req_cover_foreign_from_spoon", {
            clientMutationId: "native-foreign-cover-from-spoon",
            activate: true,
            generateEditorial: false,
          }),
          `recipes/${recipe.id}/covers/from-spoon/${spoon.id}`,
        )),
      ],
    ] as const;

    for (const [requestId, dispatch] of attempts) {
      const response = await dispatch();
      expect(response.status).toBe(403);
      expectErrorEnvelope(await readJson(response), requestId, "insufficient_scope", 403);
    }

    expect(photos.puts).toEqual([]);
    await expect(db.recipeCover.count({ where: { recipeId: recipe.id } })).resolves.toBe(2);
    await expect(db.recipeCover.findUniqueOrThrow({
      where: { id: inactive.id },
      select: { status: true, generationStatus: true, archivedAt: true },
    })).resolves.toEqual({ status: "ready", generationStatus: "succeeded", archivedAt: null });
    await expect(db.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
      select: { activeCoverId: true, activeCoverVariant: true, coverMode: true },
    })).resolves.toEqual({ activeCoverId: active.id, activeCoverVariant: "image", coverMode: "manual" });
  });

  it("uploads a recipe image as an active raw cover and rejects malformed uploads without side effects", async () => {
    const { chef, writer, recipe } = await createCoverFixture(db);
    const photos = createMemoryPhotosBucket();
    const clientMutationId = "native-upload-cover-1";
    const response = await action(routeArgs(
      multipartImageRequest(
        `recipes/${recipe.id}/image`,
        writer.token,
        "req_cover_image_upload",
        clientMutationId,
        new File([VALID_PNG_BYTES], "cover.png", { type: "image/png" }),
        { activate: "true", generateEditorial: "false" },
      ),
      `recipes/${recipe.id}/image`,
      { PHOTOS: photos.bucket },
    ));
    const payload = await readJson(response);

    expect(response.status).toBe(201);
    expectPrivateEnvelopeHeaders(response, "req_cover_image_upload");
    expectSuccessEnvelope(payload, "req_cover_image_upload");
    expectCoverMutationData(payload.data, clientMutationId, false);
    expect(payload.data.createdCover).toMatchObject({
      recipeId: recipe.id,
      sourceType: "chef-upload",
      status: "ready",
      generationStatus: "none",
      createdById: chef.id,
      activeVariant: "image",
    });
    expect(payload.data.activeCover).toMatchObject({
      id: payload.data.createdCover.id,
      activeVariant: "image",
      displayUrl: payload.data.createdCover.imageUrl,
    });
    expect(payload.data.nextActions).toEqual(["list_recipe_covers", "get_recipe"]);
    expect(photos.puts).toHaveLength(1);
    expect(photos.puts[0]).toMatchObject({
      key: expect.stringMatching(new RegExp(`^recipes/${chef.id}/${recipe.id}/idempotent-[a-f0-9]{24}-[a-f0-9]{16}\\.png$`)),
      options: { httpMetadata: { contentType: "image/png" } },
    });

    const stored = await db.recipeCover.findUniqueOrThrow({
      where: { id: payload.data.createdCover.id },
    });
    expect(stored).toMatchObject({
      recipeId: recipe.id,
      imageUrl: payload.data.createdCover.imageUrl,
      sourceType: "chef-upload",
      status: "ready",
      generationStatus: "none",
      createdById: chef.id,
    });
    await expect(db.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
      select: { activeCoverId: true, activeCoverVariant: true, coverMode: true },
    })).resolves.toEqual({
      activeCoverId: stored.id,
      activeCoverVariant: "image",
      coverMode: "manual",
    });

    const replay = await action(routeArgs(
      multipartImageRequest(
        `recipes/${recipe.id}/image`,
        writer.token,
        "req_cover_image_upload_replay",
        clientMutationId,
        new File([VALID_PNG_BYTES], "cover.png", { type: "image/png" }),
        { activate: "true", generateEditorial: "false" },
      ),
      `recipes/${recipe.id}/image`,
      { PHOTOS: photos.bucket },
    ));
    const replayPayload = await readJson(replay);
    expect(replay.status).toBe(201);
    expectSuccessEnvelope(replayPayload, "req_cover_image_upload_replay");
    expectCoverMutationData(replayPayload.data, clientMutationId, true);
    expect(replayPayload.data.createdCover.id).toBe(stored.id);
    expect(photos.puts).toHaveLength(1);
    await expect(db.recipeCover.count({ where: { recipeId: recipe.id } })).resolves.toBe(1);

    const conflict = await action(routeArgs(
      multipartImageRequest(
        `recipes/${recipe.id}/image`,
        writer.token,
        "req_cover_image_upload_conflict",
        clientMutationId,
        new File([VALID_PNG_BYTES], "cover.png", { type: "image/png" }),
        { activate: "false", generateEditorial: "false" },
      ),
      `recipes/${recipe.id}/image`,
      { PHOTOS: photos.bucket },
    ));
    expect(conflict.status).toBe(409);
    expectErrorEnvelope(await readJson(conflict), "req_cover_image_upload_conflict", "idempotency_conflict", 409);
    expect(photos.puts).toHaveLength(1);

    const invalidContent = await action(routeArgs(
      jsonMutationRequest(
        "POST",
        `recipes/${recipe.id}/image`,
        writer.token,
        "req_cover_image_json",
        { clientMutationId: "image-json-is-not-upload" },
      ),
      `recipes/${recipe.id}/image`,
      { PHOTOS: photos.bucket },
    ));
    expect(invalidContent.status).toBe(400);
    expectErrorEnvelope(await readJson(invalidContent), "req_cover_image_json", "validation_error", 400, true);

    const disguisedGif = await action(routeArgs(
      multipartImageRequest(
        `recipes/${recipe.id}/image`,
        writer.token,
        "req_cover_image_gif",
        "native-upload-cover-gif",
        new File([GIF_BYTES], "cover.png", { type: "image/png" }),
      ),
      `recipes/${recipe.id}/image`,
      { PHOTOS: photos.bucket },
    ));
    expect(disguisedGif.status).toBe(400);
    expectErrorEnvelope(await readJson(disguisedGif), "req_cover_image_gif", "validation_error", 400, true);

    const oversized = await action(routeArgs(
      multipartImageRequest(
        `recipes/${recipe.id}/image`,
        writer.token,
        "req_cover_image_too_large",
        "native-upload-cover-too-large",
        new File([new Uint8Array(IMAGE_MAX_FILE_SIZE + 1)], "huge.png", { type: "image/png" }),
      ),
      `recipes/${recipe.id}/image`,
      { PHOTOS: photos.bucket },
    ));
    expect(oversized.status).toBe(400);
    expectErrorEnvelope(await readJson(oversized), "req_cover_image_too_large", "validation_error", 400, true);

    expect(photos.puts).toHaveLength(1);
    await expect(db.recipeCover.count({ where: { recipeId: recipe.id } })).resolves.toBe(1);
  });

  it("supports env-less local image fallback for native upload and URL cover creation", async () => {
    const { chef, writer, recipe } = await createCoverFixture(db);
    const uploadClientMutationId = "native-upload-cover-local-fallback";
    const upload = await action(routeArgs(
      multipartImageRequest(
        `recipes/${recipe.id}/image`,
        writer.token,
        "req_cover_image_upload_local_fallback",
        uploadClientMutationId,
        new File([VALID_PNG_BYTES], "cover.png", { type: "image/png" }),
        { activate: "false", generateEditorial: "false" },
      ),
      `recipes/${recipe.id}/image`,
    ));
    const uploadPayload = await readJson(upload);

    expect(upload.status).toBe(201);
    expectSuccessEnvelope(uploadPayload, "req_cover_image_upload_local_fallback");
    expectCoverMutationData(uploadPayload.data, uploadClientMutationId, false);
    expect(uploadPayload.data.createdCover).toMatchObject({
      recipeId: recipe.id,
      sourceType: "chef-upload",
      status: "ready",
      generationStatus: "none",
      createdById: chef.id,
      imageUrl: expect.stringMatching(/^data:image\/png;base64,/),
    });

    const createClientMutationId = "native-create-cover-local-fallback";
    const create = await action(routeArgs(
      jsonMutationRequest("POST", `recipes/${recipe.id}/covers`, writer.token, "req_cover_create_url_local_fallback", {
        clientMutationId: createClientMutationId,
        imageUrl: dataUrl(),
        activate: false,
        generateEditorial: false,
      }),
      `recipes/${recipe.id}/covers`,
    ));
    const createPayload = await readJson(create);

    expect(create.status).toBe(201);
    expectSuccessEnvelope(createPayload, "req_cover_create_url_local_fallback");
    expectCoverMutationData(createPayload.data, createClientMutationId, false);
    expect(createPayload.data.createdCover).toMatchObject({
      recipeId: recipe.id,
      sourceType: "chef-upload",
      status: "ready",
      generationStatus: "none",
      createdById: chef.id,
      imageUrl: dataUrl(),
    });
    await expect(db.recipeCover.count({ where: { recipeId: recipe.id } })).resolves.toBe(2);
  });

  it("recovers in-flight idempotent cover mutations through every route wrapper", async () => {
    const { chef, otherChef, writer, recipe } = await createCoverFixture(db);
    const uploadClientMutationId = "native-route-recover-upload";
    const uploadBody = {
      clientMutationId: uploadClientMutationId,
      activate: false,
      generateEditorial: false,
      image: {
        name: "cover.png",
        type: "image/png",
        size: VALID_PNG_BYTES.length,
        sha256: await sha256Hex(VALID_PNG_BYTES),
      },
    };
    const uploadReservation = await seedInFlightCoverMutation(db, {
      chefId: chef.id,
      credentialId: writer.credential.id,
      clientMutationId: uploadClientMutationId,
      operation: "recipes.image.upload",
      method: "POST",
      pathSuffix: `recipes/${recipe.id}/image`,
      body: uploadBody,
      recipeId: recipe.id,
    });
    await db.recipeCover.create({
      data: {
        id: uploadReservation.id,
        recipeId: recipe.id,
        imageUrl: "/photos/recipes/recovered-upload.png",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "none",
        createdById: chef.id,
      },
    });
    const recoveredUpload = await action(routeArgs(
      multipartImageRequest(
        `recipes/${recipe.id}/image`,
        writer.token,
        "req_cover_recover_upload",
        uploadClientMutationId,
        new File([VALID_PNG_BYTES], "cover.png", { type: "image/png" }),
        { activate: "false", generateEditorial: "false" },
      ),
      `recipes/${recipe.id}/image`,
    ));
    expect(recoveredUpload.status).toBe(201);
    expectCoverMutationData((await readJson(recoveredUpload)).data, uploadClientMutationId, true);

    const createBody = {
      clientMutationId: "native-route-recover-create",
      imageUrl: `/photos/recipes/${chef.id}/uploads/recovered-url.png`,
      activate: false,
      generateEditorial: false,
    };
    const createReservation = await seedInFlightCoverMutation(db, {
      chefId: chef.id,
      credentialId: writer.credential.id,
      clientMutationId: createBody.clientMutationId,
      operation: "recipes.covers.create",
      method: "POST",
      pathSuffix: `recipes/${recipe.id}/covers`,
      body: createBody,
      recipeId: recipe.id,
    });
    await db.recipeCover.create({
      data: {
        id: createReservation.id,
        recipeId: recipe.id,
        imageUrl: createBody.imageUrl,
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "none",
        createdById: chef.id,
      },
    });
    const recoveredCreate = await action(routeArgs(
      jsonMutationRequest("POST", `recipes/${recipe.id}/covers`, writer.token, "req_cover_recover_create", createBody),
      `recipes/${recipe.id}/covers`,
    ));
    expect(recoveredCreate.status).toBe(201);
    expectCoverMutationData((await readJson(recoveredCreate)).data, createBody.clientMutationId, true);

    const activateCover = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/recipes/activate-recovered.png",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "none",
        createdById: chef.id,
      },
    });
    const activateBody = { clientMutationId: "native-route-recover-activate", variant: "image" };
    await seedInFlightCoverMutation(db, {
      chefId: chef.id,
      credentialId: writer.credential.id,
      clientMutationId: activateBody.clientMutationId,
      operation: "recipes.covers.activate",
      method: "PATCH",
      pathSuffix: `recipes/${recipe.id}/covers/${activateCover.id}`,
      body: activateBody,
      coverId: activateCover.id,
      recipeId: recipe.id,
    });
    const recoveredActivate = await action(routeArgs(
      jsonMutationRequest("PATCH", `recipes/${recipe.id}/covers/${activateCover.id}`, writer.token, "req_cover_recover_activate", activateBody),
      `recipes/${recipe.id}/covers/${activateCover.id}`,
    ));
    expect(recoveredActivate.status).toBe(200);
    expectActiveCoverMutationData((await readJson(recoveredActivate)).data, activateBody.clientMutationId, true);

    const archiveCover = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/recipes/archive-recovered.png",
        sourceType: "chef-upload",
        status: "archived",
        generationStatus: "none",
        archivedAt: new Date(),
        createdById: chef.id,
      },
    });
    const archiveRequestBody = { clientMutationId: "native-route-recover-archive", confirmNoCover: true };
    const archiveIdempotencyBody = {
      clientMutationId: archiveRequestBody.clientMutationId,
      replacementCoverId: null,
      replacementVariant: null,
      confirmNoCover: true,
      deleteSafeObjects: false,
    };
    await seedInFlightCoverMutation(db, {
      chefId: chef.id,
      credentialId: writer.credential.id,
      clientMutationId: archiveRequestBody.clientMutationId,
      operation: "recipes.covers.archive",
      method: "DELETE",
      pathSuffix: `recipes/${recipe.id}/covers/${archiveCover.id}`,
      body: archiveIdempotencyBody,
      coverId: archiveCover.id,
      recipeId: recipe.id,
    });
    const recoveredArchive = await action(routeArgs(
      jsonMutationRequest("DELETE", `recipes/${recipe.id}/covers/${archiveCover.id}`, writer.token, "req_cover_recover_archive", archiveRequestBody),
      `recipes/${recipe.id}/covers/${archiveCover.id}`,
    ));
    expect(recoveredArchive.status).toBe(200);
    expectActiveCoverMutationData((await readJson(recoveredArchive)).data, archiveRequestBody.clientMutationId, true);

    const regenerateCover = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/recipes/regenerate-recovered.png",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "none",
        createdById: chef.id,
      },
    });
    const regenerateBody = {
      clientMutationId: "native-route-recover-regenerate",
      coverId: regenerateCover.id,
      activateWhenReady: false,
    };
    await seedInFlightCoverMutation(db, {
      chefId: chef.id,
      credentialId: writer.credential.id,
      clientMutationId: regenerateBody.clientMutationId,
      operation: "recipes.covers.regenerate",
      method: "POST",
      pathSuffix: `recipes/${recipe.id}/covers/regenerate`,
      body: regenerateBody,
      coverId: regenerateCover.id,
      recipeId: recipe.id,
    });
    const recoveredRegenerate = await action(routeArgs(
      jsonMutationRequest("POST", `recipes/${recipe.id}/covers/regenerate`, writer.token, "req_cover_recover_regenerate", regenerateBody),
      `recipes/${recipe.id}/covers/regenerate`,
    ));
    expect(recoveredRegenerate.status).toBe(200);
    expectCoverMutationData((await readJson(recoveredRegenerate)).data, regenerateBody.clientMutationId, true);

    const spoon = await db.recipeSpoon.create({
      data: {
        recipeId: recipe.id,
        chefId: otherChef.id,
        photoUrl: "/photos/spoons/route-recovered.jpg",
      },
    });
    const fromSpoonBody = {
      clientMutationId: "native-route-recover-from-spoon",
      activate: false,
      generateEditorial: false,
    };
    const fromSpoonReservation = await seedInFlightCoverMutation(db, {
      chefId: chef.id,
      credentialId: writer.credential.id,
      clientMutationId: fromSpoonBody.clientMutationId,
      operation: "recipes.covers.from-spoon",
      method: "POST",
      pathSuffix: `recipes/${recipe.id}/covers/from-spoon/${spoon.id}`,
      body: fromSpoonBody,
      recipeId: recipe.id,
    });
    await db.recipeCover.create({
      data: {
        id: fromSpoonReservation.id,
        recipeId: recipe.id,
        imageUrl: "/photos/spoons/route-recovered.jpg",
        sourceType: "spoon",
        sourceSpoonId: spoon.id,
        sourceImageUrl: "/photos/spoons/route-recovered.jpg",
        status: "ready",
        generationStatus: "none",
        createdById: chef.id,
      },
    });
    const recoveredFromSpoon = await action(routeArgs(
      jsonMutationRequest("POST", `recipes/${recipe.id}/covers/from-spoon/${spoon.id}`, writer.token, "req_cover_recover_from_spoon", fromSpoonBody),
      `recipes/${recipe.id}/covers/from-spoon/${spoon.id}`,
    ));
    expect(recoveredFromSpoon.status).toBe(201);
    expectCoverMutationData((await readJson(recoveredFromSpoon)).data, fromSpoonBody.clientMutationId, true);
  });

  it("creates idempotent uploaded-image cover candidates only from safe owner-owned Spoonjoy photo URLs", async () => {
    const { chef, writer, recipe } = await createCoverFixture(db);
    const imageKey = `recipes/${chef.id}/uploads/raw.png`;
    const photos = createMemoryPhotosBucket([imageKey]);
    const imageUrl = `/photos/${imageKey}`;
    const clientMutationId = "native-create-cover-from-url-1";
    const requestBody = {
      clientMutationId,
      imageUrl,
      activate: true,
      generateEditorial: false,
    };

    const first = await action(routeArgs(
      jsonMutationRequest("POST", `recipes/${recipe.id}/covers`, writer.token, "req_cover_create_url", requestBody),
      `recipes/${recipe.id}/covers`,
      { PHOTOS: photos.bucket },
    ));
    const firstPayload = await readJson(first);
    const replay = await action(routeArgs(
      jsonMutationRequest("POST", `recipes/${recipe.id}/covers`, writer.token, "req_cover_create_url_replay", requestBody),
      `recipes/${recipe.id}/covers`,
      { PHOTOS: photos.bucket },
    ));
    const replayPayload = await readJson(replay);

    expect(first.status).toBe(201);
    expectSuccessEnvelope(firstPayload, "req_cover_create_url");
    expectCoverMutationData(firstPayload.data, clientMutationId, false);
    expect(firstPayload.data.createdCover).toMatchObject({
      recipeId: recipe.id,
      imageUrl,
      sourceType: "chef-upload",
      status: "ready",
      generationStatus: "none",
      activeVariant: "image",
    });
    expect(firstPayload.data.activeCover).toMatchObject({
      id: firstPayload.data.createdCover.id,
      activeVariant: "image",
    });

    expect(replay.status).toBe(201);
    expectSuccessEnvelope(replayPayload, "req_cover_create_url_replay");
    expectCoverMutationData(replayPayload.data, clientMutationId, true);
    expect(replayPayload.data.createdCover.id).toBe(firstPayload.data.createdCover.id);
    await expect(db.recipeCover.count({ where: { recipeId: recipe.id } })).resolves.toBe(1);

    const conflict = await action(routeArgs(
      jsonMutationRequest("POST", `recipes/${recipe.id}/covers`, writer.token, "req_cover_create_url_conflict", {
        ...requestBody,
        activate: false,
      }),
      `recipes/${recipe.id}/covers`,
      { PHOTOS: photos.bucket },
    ));
    expect(conflict.status).toBe(409);
    expectErrorEnvelope(await readJson(conflict), "req_cover_create_url_conflict", "idempotency_conflict", 409);
    await expect(db.recipeCover.count({ where: { recipeId: recipe.id } })).resolves.toBe(1);

    for (const [requestId, badImageUrl, message] of [
      ["req_cover_external_url", "https://example.com/raw.png", "Spoonjoy uploaded image URL"],
      ["req_cover_foreign_url", "/photos/recipes/other-user/uploads/raw.png", "belong to the recipe owner"],
      ["req_cover_missing_url", `/photos/recipes/${chef.id}/uploads/missing.png`, "does not exist in storage"],
      ["req_cover_unsafe_url", `/photos/recipes/${chef.id}/uploads/../raw.png`, "clean Spoonjoy uploaded image URL"],
    ] as const) {
      const invalid = await action(routeArgs(
        jsonMutationRequest("POST", `recipes/${recipe.id}/covers`, writer.token, requestId, {
          clientMutationId: `${requestId}-mutation`,
          imageUrl: badImageUrl,
        }),
        `recipes/${recipe.id}/covers`,
        { PHOTOS: photos.bucket },
      ));
      const invalidPayload = await readJson(invalid);
      expect(invalid.status).toBe(400);
      expectErrorEnvelope(invalidPayload, requestId, "validation_error", 400);
      expect(invalidPayload.error.message).toContain(message);
    }

    await expect(db.recipeCover.count({ where: { recipeId: recipe.id } })).resolves.toBe(1);
  });

  it("sets active cover variants and archives inactive or active covers through explicit lifecycle choices", async () => {
    const { chef, writer, recipe } = await createCoverFixture(db);
    const previous = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/recipes/owner/previous.jpg",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "none",
        createdById: chef.id,
      },
    });
    const replacement = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/recipes/owner/replacement.jpg",
        stylizedImageUrl: "/photos/recipes/owner/replacement-editorial.jpg",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "succeeded",
        createdById: chef.id,
      },
    });
    await db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverId: previous.id, activeCoverVariant: "image", coverMode: "manual" },
    });

    const activateBody = {
      clientMutationId: "native-set-active-cover-1",
      variant: "stylized",
    };
    const activate = await action(routeArgs(
      jsonMutationRequest(
        "PATCH",
        `recipes/${recipe.id}/covers/${replacement.id}`,
        writer.token,
        "req_cover_activate",
        activateBody,
      ),
      `recipes/${recipe.id}/covers/${replacement.id}`,
    ));
    const activatePayload = await readJson(activate);
    const activateReplay = await action(routeArgs(
      jsonMutationRequest(
        "PATCH",
        `recipes/${recipe.id}/covers/${replacement.id}`,
        writer.token,
        "req_cover_activate_replay",
        activateBody,
      ),
      `recipes/${recipe.id}/covers/${replacement.id}`,
    ));
    const activateReplayPayload = await readJson(activateReplay);

    expect(activate.status).toBe(200);
    expectSuccessEnvelope(activatePayload, "req_cover_activate");
    expectActiveCoverMutationData(activatePayload.data, activateBody.clientMutationId, false);
    expect(activatePayload.data).toMatchObject({
      activeCover: { id: replacement.id, activeVariant: "stylized" },
      previousActiveCover: { id: previous.id, activeVariant: "image" },
      archivedCover: null,
    });
    expect(activatePayload.data.nextActions).toContain("list_recipe_covers");
      expect(activateReplay.status).toBe(200);
      expectActiveCoverMutationData(activateReplayPayload.data, activateBody.clientMutationId, true);

      const activateConflict = await action(routeArgs(
        jsonMutationRequest("PATCH", `recipes/${recipe.id}/covers/${replacement.id}`, writer.token, "req_cover_activate_conflict", {
          clientMutationId: activateBody.clientMutationId,
          variant: "image",
        }),
        `recipes/${recipe.id}/covers/${replacement.id}`,
      ));
      expect(activateConflict.status).toBe(409);
      expectErrorEnvelope(await readJson(activateConflict), "req_cover_activate_conflict", "idempotency_conflict", 409);

      const invalidVariant = await action(routeArgs(
      jsonMutationRequest("PATCH", `recipes/${recipe.id}/covers/${replacement.id}`, writer.token, "req_cover_invalid_variant", {
        clientMutationId: "native-set-active-cover-invalid",
        variant: "poster",
      }),
      `recipes/${recipe.id}/covers/${replacement.id}`,
    ));
    expect(invalidVariant.status).toBe(400);
    expectErrorEnvelope(await readJson(invalidVariant), "req_cover_invalid_variant", "validation_error", 400);

    const inactiveArchive = await action(routeArgs(
      jsonMutationRequest("DELETE", `recipes/${recipe.id}/covers/${previous.id}`, writer.token, "req_cover_archive_inactive", {
        clientMutationId: "native-archive-inactive-cover-1",
      }),
      `recipes/${recipe.id}/covers/${previous.id}`,
    ));
    const inactiveArchivePayload = await readJson(inactiveArchive);
    expect(inactiveArchive.status).toBe(200);
    expectActiveCoverMutationData(inactiveArchivePayload.data, "native-archive-inactive-cover-1", false);
    expect(inactiveArchivePayload.data).toMatchObject({
      activeCover: { id: replacement.id },
      previousActiveCover: { id: replacement.id },
      archivedCover: { id: previous.id, status: "archived", activeVariant: null },
    });
    expect(inactiveArchivePayload.data.archivedCover.archivedAt).toEqual(expect.any(String));

    const inactiveArchiveReplay = await action(routeArgs(
      jsonMutationRequest("DELETE", `recipes/${recipe.id}/covers/${previous.id}`, writer.token, "req_cover_archive_inactive_replay", {
        clientMutationId: "native-archive-inactive-cover-1",
      }),
      `recipes/${recipe.id}/covers/${previous.id}`,
    ));
    const inactiveArchiveReplayPayload = await readJson(inactiveArchiveReplay);
    expect(inactiveArchiveReplay.status).toBe(200);
    expectActiveCoverMutationData(inactiveArchiveReplayPayload.data, "native-archive-inactive-cover-1", true);
    expect(inactiveArchiveReplayPayload.data.archivedCover.id).toBe(previous.id);

    const inactiveArchiveConflict = await action(routeArgs(
      jsonMutationRequest("DELETE", `recipes/${recipe.id}/covers/${previous.id}`, writer.token, "req_cover_archive_inactive_conflict", {
        clientMutationId: "native-archive-inactive-cover-1",
        deleteSafeObjects: true,
      }),
      `recipes/${recipe.id}/covers/${previous.id}`,
    ));
    expect(inactiveArchiveConflict.status).toBe(409);
    expectErrorEnvelope(await readJson(inactiveArchiveConflict), "req_cover_archive_inactive_conflict", "idempotency_conflict", 409);

    const activeReplacementTarget = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/recipes/owner/archive-target.jpg",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "none",
        createdById: chef.id,
      },
    });
    const nextReplacement = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/recipes/owner/next-replacement.jpg",
        stylizedImageUrl: "/photos/recipes/owner/next-replacement-editorial.jpg",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "succeeded",
        createdById: chef.id,
      },
    });
    await db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverId: activeReplacementTarget.id, activeCoverVariant: "image", coverMode: "manual" },
    });
    const replacementArchiveBody = {
      clientMutationId: "native-archive-active-with-replacement-1",
      replacementCoverId: nextReplacement.id,
      replacementVariant: "stylized",
    };
    const replacementArchive = await action(routeArgs(
      jsonMutationRequest("DELETE", `recipes/${recipe.id}/covers/${activeReplacementTarget.id}`, writer.token, "req_cover_archive_with_replacement", replacementArchiveBody),
      `recipes/${recipe.id}/covers/${activeReplacementTarget.id}`,
    ));
    const replacementArchivePayload = await readJson(replacementArchive);
    expect(replacementArchive.status).toBe(200);
    expectActiveCoverMutationData(replacementArchivePayload.data, replacementArchiveBody.clientMutationId, false);
    expect(replacementArchivePayload.data).toMatchObject({
      activeCover: { id: nextReplacement.id, activeVariant: "stylized" },
      previousActiveCover: { id: activeReplacementTarget.id, activeVariant: "image" },
      archivedCover: { id: activeReplacementTarget.id, status: "archived", activeVariant: null },
    });
    await expect(db.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
      select: { activeCoverId: true, activeCoverVariant: true, coverMode: true },
    })).resolves.toEqual({
      activeCoverId: nextReplacement.id,
      activeCoverVariant: "stylized",
      coverMode: "manual",
    });

    const replacementArchiveReplay = await action(routeArgs(
      jsonMutationRequest("DELETE", `recipes/${recipe.id}/covers/${activeReplacementTarget.id}`, writer.token, "req_cover_archive_with_replacement_replay", replacementArchiveBody),
      `recipes/${recipe.id}/covers/${activeReplacementTarget.id}`,
    ));
    const replacementArchiveReplayPayload = await readJson(replacementArchiveReplay);
    expect(replacementArchiveReplay.status).toBe(200);
    expectActiveCoverMutationData(replacementArchiveReplayPayload.data, replacementArchiveBody.clientMutationId, true);
    expect(replacementArchiveReplayPayload.data.archivedCover.id).toBe(activeReplacementTarget.id);

    const replacementArchiveConflict = await action(routeArgs(
      jsonMutationRequest("DELETE", `recipes/${recipe.id}/covers/${activeReplacementTarget.id}`, writer.token, "req_cover_archive_with_replacement_conflict", {
        ...replacementArchiveBody,
        replacementVariant: "image",
      }),
      `recipes/${recipe.id}/covers/${activeReplacementTarget.id}`,
    ));
    expect(replacementArchiveConflict.status).toBe(409);
    expectErrorEnvelope(await readJson(replacementArchiveConflict), "req_cover_archive_with_replacement_conflict", "idempotency_conflict", 409);

    await db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverId: replacement.id, activeCoverVariant: "stylized", coverMode: "manual" },
    });

    const activeWithoutChoice = await action(routeArgs(
      jsonMutationRequest("DELETE", `recipes/${recipe.id}/covers/${replacement.id}`, writer.token, "req_cover_archive_active_denied", {
        clientMutationId: "native-archive-active-denied",
      }),
      `recipes/${recipe.id}/covers/${replacement.id}`,
    ));
    expect(activeWithoutChoice.status).toBe(400);
    expectErrorEnvelope(await readJson(activeWithoutChoice), "req_cover_archive_active_denied", "validation_error", 400);

    const activeArchive = await action(routeArgs(
      jsonMutationRequest("DELETE", `recipes/${recipe.id}/covers/${replacement.id}`, writer.token, "req_cover_archive_active", {
        clientMutationId: "native-archive-active-cover-1",
        confirmNoCover: true,
        deleteSafeObjects: true,
      }),
      `recipes/${recipe.id}/covers/${replacement.id}`,
    ));
    const activeArchivePayload = await readJson(activeArchive);
    expect(activeArchive.status).toBe(200);
    expectActiveCoverMutationData(activeArchivePayload.data, "native-archive-active-cover-1", false);
    expect(activeArchivePayload.data).toMatchObject({
      activeCover: null,
      previousActiveCover: { id: replacement.id, activeVariant: "stylized" },
      archivedCover: { id: replacement.id, status: "archived" },
      warnings: ["deleteSafeObjects is not implemented; the cover record was archived without deleting image objects."],
    });
    await expect(db.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
      select: { activeCoverId: true, activeCoverVariant: true, coverMode: true },
    })).resolves.toEqual({ activeCoverId: null, activeCoverVariant: null, coverMode: "none" });
  });

  it("regenerates covers with canonical provider-secret blocker artifacts when local AI secrets are absent", async () => {
    const { chef, writer, recipe } = await createCoverFixture(db);
    const cover = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: dataUrl(),
        sourceType: "chef-upload",
        sourceImageUrl: dataUrl(),
        status: "ready",
        generationStatus: "none",
        createdById: chef.id,
      },
    });
    await db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverId: cover.id, activeCoverVariant: "image", coverMode: "manual" },
    });
    const blockerPath = providerBlockerPath();
    const clientMutationId = "native-regenerate-cover-no-provider-1";
    const response = await action(routeArgs(
      jsonMutationRequest("POST", `recipes/${recipe.id}/covers/regenerate`, writer.token, "req_cover_regenerate_no_provider", {
        clientMutationId,
        coverId: cover.id,
        activateWhenReady: true,
      }),
      `recipes/${recipe.id}/covers/regenerate`,
      {
        ARTIFACT_ROOT: artifactRoot(),
        OPENAI_API_KEY: "",
        GEMINI_API_KEY: "",
        GOOGLE_API_KEY: "",
      },
    ));
    const payload = await readJson(response);

    expect(response.status).toBe(202);
    expectPrivateEnvelopeHeaders(response, "req_cover_regenerate_no_provider");
    expectSuccessEnvelope(payload, "req_cover_regenerate_no_provider");
    expectCoverMutationData(payload.data, clientMutationId, false, { created: true, blockers: true });
    expect(payload.data.createdCover).toMatchObject({
      id: cover.id,
      status: "ready",
      generationStatus: "failed",
      failureReason: "missing_image_provider_config",
      sourceImageUrl: dataUrl(),
    });
    expect(payload.data.activeCover).toMatchObject({ id: cover.id, activeVariant: "image" });
    expect(payload.data.blockers).toHaveLength(1);
    expectProviderBlockerShape(payload.data.blockers[0], blockerPath);

    const blocker = JSON.parse(await readFile(blockerPath, "utf8")) as Record<string, unknown>;
    expectProviderBlockerShape(blocker, blockerPath);
    const blockerFiles = (await readdir(path.dirname(blockerPath)))
      .filter((fileName) => fileName.startsWith("provider-secret-blocker-"));
    expect(blockerFiles).toEqual(["provider-secret-blocker-recipe-covers.json"]);

    const replay = await action(routeArgs(
      jsonMutationRequest("POST", `recipes/${recipe.id}/covers/regenerate`, writer.token, "req_cover_regenerate_no_provider_replay", {
        clientMutationId,
        coverId: cover.id,
        activateWhenReady: true,
      }),
      `recipes/${recipe.id}/covers/regenerate`,
      {
        ARTIFACT_ROOT: artifactRoot(),
        OPENAI_API_KEY: "",
        GEMINI_API_KEY: "",
        GOOGLE_API_KEY: "",
      },
    ));
    const replayPayload = await readJson(replay);
    expect(replay.status).toBe(202);
    expectSuccessEnvelope(replayPayload, "req_cover_regenerate_no_provider_replay");
    expectCoverMutationData(replayPayload.data, clientMutationId, true, { created: true, blockers: true });
    expect(replayPayload.data.createdCover.id).toBe(cover.id);
    expectProviderBlockerShape(replayPayload.data.blockers[0], blockerPath);

    const conflict = await action(routeArgs(
      jsonMutationRequest("POST", `recipes/${recipe.id}/covers/regenerate`, writer.token, "req_cover_regenerate_no_provider_conflict", {
        clientMutationId,
        coverId: cover.id,
        activateWhenReady: false,
      }),
      `recipes/${recipe.id}/covers/regenerate`,
      {
        ARTIFACT_ROOT: artifactRoot(),
        OPENAI_API_KEY: "",
        GEMINI_API_KEY: "",
        GOOGLE_API_KEY: "",
      },
    ));
    expect(conflict.status).toBe(409);
    expectErrorEnvelope(await readJson(conflict), "req_cover_regenerate_no_provider_conflict", "idempotency_conflict", 409);
    await expect(db.recipeCover.count({ where: { recipeId: recipe.id } })).resolves.toBe(1);

    const archived = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: dataUrl(),
        sourceType: "chef-upload",
        status: "archived",
        generationStatus: "none",
        archivedAt: new Date(),
      },
    });
    const invalid = await action(routeArgs(
      jsonMutationRequest("POST", `recipes/${recipe.id}/covers/regenerate`, writer.token, "req_cover_regenerate_archived", {
        clientMutationId: "native-regenerate-cover-archived",
        coverId: archived.id,
      }),
      `recipes/${recipe.id}/covers/regenerate`,
    ));
    expect(invalid.status).toBe(400);
    expectErrorEnvelope(await readJson(invalid), "req_cover_regenerate_archived", "validation_error", 400);
  });

  it("returns canonical provider-secret blockers for editorial upload, URL, and spoon cover creation", async () => {
    const { chef, otherChef, writer, recipe } = await createCoverFixture(db);
    const imageKey = `recipes/${chef.id}/uploads/editorial-source.png`;
    const photos = createMemoryPhotosBucket([imageKey]);
    const blockerPath = providerBlockerPath();
    const providerEnv = {
      PHOTOS: photos.bucket,
      ARTIFACT_ROOT: artifactRoot(),
      OPENAI_API_KEY: "",
      GEMINI_API_KEY: "",
      GOOGLE_API_KEY: "",
    };

    const noArtifactRootClientMutationId = "native-create-cover-provider-no-artifact-root";
    const noArtifactRoot = await action(routeArgs(
      jsonMutationRequest("POST", `recipes/${recipe.id}/covers`, writer.token, "req_cover_create_url_provider_no_artifact_root", {
        clientMutationId: noArtifactRootClientMutationId,
        imageUrl: `/photos/${imageKey}`,
        activate: false,
        generateEditorial: true,
      }),
      `recipes/${recipe.id}/covers`,
      {
        PHOTOS: photos.bucket,
        OPENAI_API_KEY: "",
        GEMINI_API_KEY: "",
        GOOGLE_API_KEY: "",
      },
    ));
    const noArtifactRootPayload = await readJson(noArtifactRoot);
    expect(noArtifactRoot.status).toBe(202);
    expectSuccessEnvelope(noArtifactRootPayload, "req_cover_create_url_provider_no_artifact_root");
    expectCoverMutationData(noArtifactRootPayload.data, noArtifactRootClientMutationId, false, { created: true, blockers: true });
    expectProviderBlockerShape(noArtifactRootPayload.data.blockers[0], "web/provider-secret-blocker-recipe-covers.json");
    await expect(readFile(blockerPath, "utf8")).rejects.toThrow();

    const uploadClientMutationId = "native-upload-cover-provider-blocked-1";
    const upload = await action(routeArgs(
      multipartImageRequest(
        `recipes/${recipe.id}/image`,
        writer.token,
        "req_cover_image_upload_provider_blocked",
        uploadClientMutationId,
        new File([VALID_PNG_BYTES], "cover.png", { type: "image/png" }),
        { activate: "true", generateEditorial: "true" },
      ),
      `recipes/${recipe.id}/image`,
      providerEnv,
    ));
    const uploadPayload = await readJson(upload);
    expect(upload.status).toBe(202);
    expectSuccessEnvelope(uploadPayload, "req_cover_image_upload_provider_blocked");
    expectCoverMutationData(uploadPayload.data, uploadClientMutationId, false, { created: true, blockers: true });
    expect(uploadPayload.data.createdCover).toMatchObject({
      recipeId: recipe.id,
      sourceType: "chef-upload",
      status: "ready",
      generationStatus: "failed",
      failureReason: "missing_image_provider_config",
      createdById: chef.id,
      activeVariant: "image",
    });
      expect(uploadPayload.data.activeCover).toMatchObject({
        id: uploadPayload.data.createdCover.id,
        activeVariant: "image",
      });
      expect(uploadPayload.data.blockers).toHaveLength(1);
      expectProviderBlockerShape(uploadPayload.data.blockers[0], blockerPath);

    const createClientMutationId = "native-create-cover-provider-blocked-1";
    const create = await action(routeArgs(
      jsonMutationRequest("POST", `recipes/${recipe.id}/covers`, writer.token, "req_cover_create_url_provider_blocked", {
        clientMutationId: createClientMutationId,
        imageUrl: `/photos/${imageKey}`,
        activate: true,
        generateEditorial: true,
      }),
      `recipes/${recipe.id}/covers`,
      providerEnv,
    ));
    const createPayload = await readJson(create);
    expect(create.status).toBe(202);
    expectSuccessEnvelope(createPayload, "req_cover_create_url_provider_blocked");
    expectCoverMutationData(createPayload.data, createClientMutationId, false, { created: true, blockers: true });
    expect(createPayload.data.createdCover).toMatchObject({
      recipeId: recipe.id,
      imageUrl: `/photos/${imageKey}`,
      sourceType: "chef-upload",
      status: "ready",
      generationStatus: "failed",
      failureReason: "missing_image_provider_config",
      activeVariant: "image",
    });
      expect(createPayload.data.previousActiveCover).toMatchObject({
        id: uploadPayload.data.createdCover.id,
        activeVariant: "image",
      });
      expect(createPayload.data.blockers).toHaveLength(1);
      expectProviderBlockerShape(createPayload.data.blockers[0], blockerPath);

    const spoon = await db.recipeSpoon.create({
      data: {
        recipeId: recipe.id,
        chefId: otherChef.id,
        photoUrl: "/photos/spoons/other/editorial-source.jpg",
      },
    });
    const spoonClientMutationId = "native-cover-from-spoon-provider-blocked-1";
    const fromSpoon = await action(routeArgs(
      jsonMutationRequest("POST", `recipes/${recipe.id}/covers/from-spoon/${spoon.id}`, writer.token, "req_cover_from_spoon_provider_blocked", {
        clientMutationId: spoonClientMutationId,
        activate: true,
        generateEditorial: true,
      }),
      `recipes/${recipe.id}/covers/from-spoon/${spoon.id}`,
      providerEnv,
    ));
    const fromSpoonPayload = await readJson(fromSpoon);
    expect(fromSpoon.status).toBe(202);
    expectSuccessEnvelope(fromSpoonPayload, "req_cover_from_spoon_provider_blocked");
    expectCoverMutationData(fromSpoonPayload.data, spoonClientMutationId, false, { created: true, blockers: true });
    expect(fromSpoonPayload.data.createdCover).toMatchObject({
      recipeId: recipe.id,
      imageUrl: "/photos/spoons/other/editorial-source.jpg",
      sourceType: "spoon",
      sourceSpoonId: spoon.id,
      sourceImageUrl: "/photos/spoons/other/editorial-source.jpg",
      status: "ready",
      generationStatus: "failed",
      failureReason: "missing_image_provider_config",
      createdById: chef.id,
      activeVariant: "image",
    });
      expect(fromSpoonPayload.data.previousActiveCover).toMatchObject({
        id: createPayload.data.createdCover.id,
        activeVariant: "image",
      });
      expect(fromSpoonPayload.data.blockers).toHaveLength(1);
      expectProviderBlockerShape(fromSpoonPayload.data.blockers[0], blockerPath);

    const blocker = JSON.parse(await readFile(blockerPath, "utf8")) as Record<string, unknown>;
    expectProviderBlockerShape(blocker, blockerPath);
    const blockerFiles = (await readdir(path.dirname(blockerPath)))
      .filter((fileName) => fileName.startsWith("provider-secret-blocker-"));
    expect(blockerFiles).toEqual(["provider-secret-blocker-recipe-covers.json"]);
    await expect(db.recipeCover.count({ where: { recipeId: recipe.id } })).resolves.toBe(4);
  });

  it("creates cover candidates from existing spoon photos without inventing comments or social surfaces", async () => {
    const { chef, otherChef, writer, recipe } = await createCoverFixture(db);
    const spoon = await db.recipeSpoon.create({
      data: {
        recipeId: recipe.id,
        chefId: otherChef.id,
        photoUrl: "/photos/spoons/other/cooked.jpg",
        note: "Loved the sauce",
        cookedAt: new Date("2026-01-10T00:00:00.000Z"),
      },
    });
      const noPhotoSpoon = await db.recipeSpoon.create({
        data: {
          recipeId: recipe.id,
          chefId: chef.id,
          note: "No photo here",
        },
      });
      const deletedSpoon = await db.recipeSpoon.create({
        data: {
          recipeId: recipe.id,
          chefId: otherChef.id,
          photoUrl: "/photos/spoons/other/deleted.jpg",
          deletedAt: new Date("2026-01-11T00:00:00.000Z"),
        },
      });
      const otherRecipe = await db.recipe.create({
        data: {
          ...createTestRecipe(chef.id),
        title: `Other Spoon Recipe ${faker.string.alphanumeric(8)}`,
        chefId: chef.id,
      },
    });
    const otherRecipeSpoon = await db.recipeSpoon.create({
      data: {
        recipeId: otherRecipe.id,
        chefId: chef.id,
        photoUrl: "/photos/spoons/owner/other-recipe.jpg",
      },
    });
    const clientMutationId = "native-create-cover-from-spoon-1";

    const response = await action(routeArgs(
      jsonMutationRequest("POST", `recipes/${recipe.id}/covers/from-spoon/${spoon.id}`, writer.token, "req_cover_from_spoon", {
        clientMutationId,
        activate: true,
        generateEditorial: false,
      }),
      `recipes/${recipe.id}/covers/from-spoon/${spoon.id}`,
    ));
    const payload = await readJson(response);

    expect(response.status).toBe(201);
    expectPrivateEnvelopeHeaders(response, "req_cover_from_spoon");
    expectSuccessEnvelope(payload, "req_cover_from_spoon");
    expectCoverMutationData(payload.data, clientMutationId, false);
    expect(payload.data.createdCover).toMatchObject({
      recipeId: recipe.id,
      imageUrl: "/photos/spoons/other/cooked.jpg",
      sourceType: "spoon",
      sourceSpoonId: spoon.id,
      sourceImageUrl: "/photos/spoons/other/cooked.jpg",
      status: "ready",
      generationStatus: "none",
      createdById: chef.id,
      activeVariant: "image",
    });
    expect(payload.data.activeCover).toMatchObject({
      id: payload.data.createdCover.id,
      activeVariant: "image",
    });
    expect(payload.data.createdCover).not.toHaveProperty("comment");
    expect(payload.data.createdCover).not.toHaveProperty("post");
    expect(payload.data.createdCover).not.toHaveProperty("feed");

    const replay = await action(routeArgs(
      jsonMutationRequest("POST", `recipes/${recipe.id}/covers/from-spoon/${spoon.id}`, writer.token, "req_cover_from_spoon_replay", {
        clientMutationId,
        activate: true,
        generateEditorial: false,
      }),
      `recipes/${recipe.id}/covers/from-spoon/${spoon.id}`,
    ));
    const replayPayload = await readJson(replay);
    expect(replay.status).toBe(201);
    expectSuccessEnvelope(replayPayload, "req_cover_from_spoon_replay");
    expectCoverMutationData(replayPayload.data, clientMutationId, true);
    expect(replayPayload.data.createdCover.id).toBe(payload.data.createdCover.id);
    await expect(db.recipeCover.count({ where: { recipeId: recipe.id } })).resolves.toBe(1);

    const conflict = await action(routeArgs(
      jsonMutationRequest("POST", `recipes/${recipe.id}/covers/from-spoon/${spoon.id}`, writer.token, "req_cover_from_spoon_conflict", {
        clientMutationId,
        activate: false,
        generateEditorial: false,
      }),
      `recipes/${recipe.id}/covers/from-spoon/${spoon.id}`,
    ));
    expect(conflict.status).toBe(409);
    expectErrorEnvelope(await readJson(conflict), "req_cover_from_spoon_conflict", "idempotency_conflict", 409);
    await expect(db.recipeCover.count({ where: { recipeId: recipe.id } })).resolves.toBe(1);

      for (const [requestId, spoonId] of [
        ["req_cover_from_missing_spoon", "missing-spoon"],
        ["req_cover_from_no_photo_spoon", noPhotoSpoon.id],
        ["req_cover_from_deleted_spoon", deletedSpoon.id],
        ["req_cover_from_other_recipe_spoon", otherRecipeSpoon.id],
      ] as const) {
        const invalid = await action(routeArgs(
        jsonMutationRequest("POST", `recipes/${recipe.id}/covers/from-spoon/${spoonId}`, writer.token, requestId, {
          clientMutationId: `${requestId}-mutation`,
        }),
        `recipes/${recipe.id}/covers/from-spoon/${spoonId}`,
      ));
        expect(invalid.status).toBe(404);
        expectErrorEnvelope(await readJson(invalid), requestId, "not_found", 404);
      }
      await expect(db.recipeCover.count({ where: { recipeId: recipe.id } })).resolves.toBe(1);
    });
  });
