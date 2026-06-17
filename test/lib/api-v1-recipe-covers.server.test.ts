import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import { ApiAuthError } from "~/lib/api-auth.server";
import { STYLIZATION_DAILY_CAP, startOfUtcDay } from "~/lib/image-gen-ledger.server";
import {
  archiveNativeRecipeCover,
  activateNativeRecipeCover,
  createNativeRecipeCoverFromUrl,
  listNativeRecipeCovers,
  loadOwnedNativeRecipeCoverRecipe,
  nativeRecipeCoverUploadIdempotencyBody,
  parseNativeRecipeCoverActivateBody,
  parseNativeRecipeCoverArchiveBody,
  parseNativeRecipeCoverCreateBody,
  parseNativeRecipeCoverFromSpoonBody,
  parseNativeRecipeCoverListUrl,
  parseNativeRecipeCoverRegenerateBody,
  parseNativeRecipeCoverUploadRequest,
  recoverNativeRecipeCoverMutation,
  regenerateNativeRecipeCover,
  uploadNativeRecipeImageCover,
  type ApiV1RecipeCoverResult,
} from "~/lib/api-v1-recipe-covers.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../utils";

const VALID_PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

type LocalDb = Awaited<ReturnType<typeof getLocalDb>>;

function expectOk<T>(result: ApiV1RecipeCoverResult<T>) {
  expect(result.ok).toBe(true);
  return result as Extract<ApiV1RecipeCoverResult<T>, { ok: true }>;
}

function expectValidationFailure<T>(result: ApiV1RecipeCoverResult<T>) {
  expect(result).toMatchObject({ ok: false, code: "validation_error" });
}

function expectFailure<T>(result: ApiV1RecipeCoverResult<T>, code: string) {
  expect(result).toMatchObject({ ok: false, code });
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
    } as unknown as R2Bucket,
  };
}

function transactionFailureDb(options: { cleanupStateCheckFails?: boolean; committedStateVisible?: boolean } = {}) {
  return {
    recipeCover: {
      create: vi.fn(() => Promise.resolve({ id: "cover_reservation_1" })),
      findFirst: vi.fn(async () => {
        if (options.cleanupStateCheckFails) throw new Error("cleanup state check failed");
        return options.committedStateVisible ? { id: "cover_reservation_1" } : null;
      }),
    },
    recipe: {
      update: vi.fn(() => Promise.resolve({ id: "recipe_1" })),
    },
    apiMutationTombstone: {
      upsert: vi.fn(() => Promise.resolve({ id: "tombstone_1" })),
      findFirst: vi.fn(async () => null),
    },
    $transaction: vi.fn(async () => {
      throw new Error("forced cover transaction failure");
    }),
  };
}

function uploadInput(clientMutationId: string) {
  return {
    clientMutationId,
    file: new File([VALID_PNG_BYTES], "cover.png", { type: "image/png" }),
    fileHash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    activate: true,
    generateEditorial: false,
  };
}

function multipartRequest(formData: UndiciFormData, headers: Record<string, string> = {}) {
  return new UndiciRequest("http://localhost/upload", {
    method: "POST",
    headers,
    body: formData,
  }) as unknown as Request;
}

function validUploadForm(fields: Record<string, string> = {}) {
  const formData = new UndiciFormData();
  formData.append("image", new File([VALID_PNG_BYTES], "cover.png", { type: "image/png" }));
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  return formData;
}

describe("API v1 recipe cover parsers", () => {
  it("normalizes valid upload, body, and list inputs", async () => {
    const upload = expectOk(await parseNativeRecipeCoverUploadRequest(multipartRequest(
      validUploadForm({ activate: "true", generateEditorial: "false" }),
      { "X-Client-Mutation-Id": " upload-header-id " },
    )));
    expect(upload.data).toMatchObject({
      clientMutationId: "upload-header-id",
      activate: true,
      generateEditorial: false,
      fileHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(nativeRecipeCoverUploadIdempotencyBody(upload.data)).toMatchObject({
      clientMutationId: "upload-header-id",
      activate: true,
      generateEditorial: false,
      image: {
        name: "cover.png",
        type: "image/png",
        size: VALID_PNG_BYTES.length,
        sha256: upload.data.fileHash,
      },
    });

    expect(expectOk(parseNativeRecipeCoverCreateBody({
      clientMutationId: "create",
      imageUrl: " /photos/recipes/chef/source.png ",
    })).data).toMatchObject({ imageUrl: "/photos/recipes/chef/source.png", activate: false, generateEditorial: true });
    expect(expectOk(parseNativeRecipeCoverActivateBody({ clientMutationId: "activate", variant: "stylized" }))
      .data).toEqual({ clientMutationId: "activate", variant: "stylized" });
    expect(expectOk(parseNativeRecipeCoverArchiveBody({
      replacementCoverId: " replacement ",
      replacementVariant: "image",
      confirmNoCover: true,
      deleteSafeObjects: true,
    }, " archive-fallback ")).data).toEqual({
      clientMutationId: "archive-fallback",
      replacementCoverId: "replacement",
      replacementVariant: "image",
      confirmNoCover: true,
      deleteSafeObjects: true,
    });
    expect(expectOk(parseNativeRecipeCoverArchiveBody({
      clientMutationId: "archive-empty-replacement",
      replacementCoverId: " ",
    }, "")).data).toMatchObject({ replacementCoverId: null, replacementVariant: null });
    expect(expectOk(parseNativeRecipeCoverRegenerateBody({
      clientMutationId: "regenerate",
      coverId: " cover ",
      activateWhenReady: true,
    })).data).toEqual({ clientMutationId: "regenerate", coverId: "cover", activateWhenReady: true });
    expect(expectOk(parseNativeRecipeCoverFromSpoonBody({ clientMutationId: "spoon" }))
      .data).toEqual({ clientMutationId: "spoon", activate: false, generateEditorial: true });

    expect(expectOk(parseNativeRecipeCoverListUrl(new URL("http://localhost/covers")))
      .data).toEqual({ includeArchived: false, limit: 20, offset: 0 });
    expect(expectOk(parseNativeRecipeCoverListUrl(new URL("http://localhost/covers?includeArchived=false&limit=&offset=")))
      .data).toEqual({ includeArchived: false, limit: 20, offset: 0 });
    expect(expectOk(parseNativeRecipeCoverListUrl(new URL("http://localhost/covers?includeArchived=true&limit=50&offset=2")))
      .data).toEqual({ includeArchived: true, limit: 50, offset: 2 });
  });

  it("rejects malformed upload inputs", async () => {
    expectValidationFailure(await parseNativeRecipeCoverUploadRequest(new Request("http://localhost/upload", {
      method: "POST",
      body: "",
    })));
    expectValidationFailure(await parseNativeRecipeCoverUploadRequest(new Request("http://localhost/upload", {
      method: "POST",
    })));
    expectValidationFailure(await parseNativeRecipeCoverUploadRequest(new Request("http://localhost/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })));

    const throwingRequest = {
      headers: new Headers({ "Content-Type": "multipart/form-data; boundary=bad" }),
      formData: async () => {
        throw new Error("malformed");
      },
    } as unknown as Request;
    expectValidationFailure(await parseNativeRecipeCoverUploadRequest(throwingRequest));

    const noFile = new UndiciFormData();
    noFile.append("clientMutationId", "no-file");
    expectValidationFailure(await parseNativeRecipeCoverUploadRequest(multipartRequest(noFile)));

    const invalidFile = new UndiciFormData();
    invalidFile.append("image", new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }));
    invalidFile.append("clientMutationId", "invalid-file");
    expectValidationFailure(await parseNativeRecipeCoverUploadRequest(multipartRequest(invalidFile)));

    expectValidationFailure(await parseNativeRecipeCoverUploadRequest(multipartRequest(validUploadForm())));
    expectValidationFailure(await parseNativeRecipeCoverUploadRequest(multipartRequest(validUploadForm({
      clientMutationId: "bad-activate",
      activate: "yes",
    }))));
    expectValidationFailure(await parseNativeRecipeCoverUploadRequest(multipartRequest(validUploadForm({
      clientMutationId: "bad-generate",
      generateEditorial: "yes",
    }))));
  });

  it("rejects malformed JSON body parser inputs", () => {
    for (const body of [
      { clientMutationId: "create-extra", imageUrl: "/photos/x.png", extra: true },
      { imageUrl: "/photos/x.png" },
      { clientMutationId: "create-missing-image" },
      { clientMutationId: "create-bad-activate", imageUrl: "/photos/x.png", activate: "true" },
      { clientMutationId: "create-bad-editorial", imageUrl: "/photos/x.png", generateEditorial: "true" },
    ]) {
      expectValidationFailure(parseNativeRecipeCoverCreateBody(body));
    }

    for (const body of [
      { clientMutationId: "activate-extra", variant: "image", extra: true },
      { variant: "image" },
      { clientMutationId: "activate-empty", variant: "" },
      { clientMutationId: "activate-bad", variant: "thumbnail" },
    ]) {
      expectValidationFailure(parseNativeRecipeCoverActivateBody(body));
    }

    for (const body of [
      { clientMutationId: "archive-extra", extra: true },
      {},
      { clientMutationId: "archive-bad-replacement", replacementCoverId: 42 },
      { clientMutationId: "archive-bad-variant", replacementVariant: "thumbnail" },
      { clientMutationId: "archive-bad-confirm", confirmNoCover: "true" },
      { clientMutationId: "archive-bad-delete", deleteSafeObjects: "false" },
    ]) {
      expectValidationFailure(parseNativeRecipeCoverArchiveBody(body, ""));
    }

    for (const body of [
      { clientMutationId: "regen-extra", coverId: "cover", extra: true },
      { coverId: "cover" },
      { clientMutationId: "regen-missing-cover" },
      { clientMutationId: "regen-bad-activate", coverId: "cover", activateWhenReady: "true" },
    ]) {
      expectValidationFailure(parseNativeRecipeCoverRegenerateBody(body));
    }

    for (const body of [
      { clientMutationId: "spoon-extra", extra: true },
      {},
      { clientMutationId: "spoon-bad-activate", activate: "true" },
      { clientMutationId: "spoon-bad-generate", generateEditorial: "true" },
    ]) {
      expectValidationFailure(parseNativeRecipeCoverFromSpoonBody(body));
    }

    for (const url of [
      "http://localhost/covers?includeArchived=yes",
      "http://localhost/covers?limit=0",
      "http://localhost/covers?limit=51",
      "http://localhost/covers?limit=1.5",
      "http://localhost/covers?offset=-1",
      "http://localhost/covers?offset=1.5",
    ]) {
      expectValidationFailure(parseNativeRecipeCoverListUrl(new URL(url)));
    }
  });
});

describe("API v1 recipe cover helper upload recovery", () => {
  it("deletes the deterministic uploaded object when the cover transaction fails before a tombstone exists", async () => {
    const photos = createMemoryPhotosBucket();
    const db = transactionFailureDb();

    await expect(uploadNativeRecipeImageCover(
      db as never,
      { PHOTOS: photos.bucket } as Env,
      "chef_1",
      {
        id: "recipe_1",
        title: "Offline Pasta",
        chefId: "chef_1",
        activeCoverId: null,
        activeCoverVariant: null,
        coverMode: "auto",
      },
      uploadInput("native-upload-cover-transaction-failure"),
      { id: "cover_reservation_1" } as never,
    )).rejects.toThrow("forced cover transaction failure");

    expect(photos.puts).toHaveLength(1);
    expect(photos.puts[0].key).toMatch(
      /^recipes\/chef_1\/recipe_1\/idempotent-[a-f0-9]{24}-abcdef0123456789\.png$/,
    );
    expect(photos.deletes).toEqual([photos.puts[0].key]);
    expect(db.recipeCover.findFirst).toHaveBeenCalledWith({
      where: { id: "cover_reservation_1", recipeId: "recipe_1" },
      select: { id: true },
    });
    expect(db.apiMutationTombstone.findFirst).toHaveBeenCalledWith({
      where: {
        idempotencyKeyId: "cover_reservation_1",
        resourceType: "recipe_cover",
        resourceId: "cover_reservation_1",
        parentResourceId: "recipe_1",
      },
      select: { id: true },
    });
  });

  it("keeps the uploaded object when committed cover state is visible during cleanup", async () => {
    const photos = createMemoryPhotosBucket();
    const db = transactionFailureDb({ committedStateVisible: true });

    await expect(uploadNativeRecipeImageCover(
      db as never,
      { PHOTOS: photos.bucket } as Env,
      "chef_1",
      {
        id: "recipe_1",
        title: "Offline Pasta",
        chefId: "chef_1",
        activeCoverId: null,
        activeCoverVariant: null,
        coverMode: "auto",
      },
      uploadInput("native-upload-cover-transaction-failure"),
      { id: "cover_reservation_1" } as never,
    )).rejects.toThrow("forced cover transaction failure");

    expect(photos.puts).toHaveLength(1);
    expect(photos.deletes).toEqual([]);
  });

  it("keeps the uploaded object when cleanup cannot safely verify committed state", async () => {
    const photos = createMemoryPhotosBucket();
    const db = transactionFailureDb({ cleanupStateCheckFails: true });

    await expect(uploadNativeRecipeImageCover(
      db as never,
      { PHOTOS: photos.bucket } as Env,
      "chef_1",
      {
        id: "recipe_1",
        title: "Offline Pasta",
        chefId: "chef_1",
        activeCoverId: null,
        activeCoverVariant: null,
        coverMode: "auto",
      },
      uploadInput("native-upload-cover-transaction-failure"),
      { id: "cover_reservation_1" } as never,
    )).rejects.toThrow("forced cover transaction failure");

    expect(photos.puts).toHaveLength(1);
    expect(photos.deletes).toEqual([]);
  });
});

function fakeRecipeCover(overrides: Record<string, unknown> = {}) {
  return {
    id: "cover_1",
    recipeId: "recipe_1",
    imageUrl: "/photos/recipes/cover.png",
    stylizedImageUrl: null,
    sourceType: "chef-upload",
    sourceSpoonId: null,
    status: "ready",
    createdById: "chef_1",
    sourceImageUrl: "/photos/recipes/cover.png",
    generationStatus: "none",
    failureReason: null,
    promptVersion: null,
    styleVersion: null,
    archivedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function fakeSetActiveDb(cover: unknown, thrown?: unknown) {
  return {
    recipeCover: {
      findFirst: vi.fn(async () => cover),
    },
    recipe: {
      update: vi.fn(() => Promise.resolve({ id: "recipe_1" })),
    },
    apiMutationTombstone: {
      upsert: vi.fn(() => Promise.resolve({ id: "tombstone_1" })),
    },
    $transaction: vi.fn(async () => {
      if (thrown !== undefined) throw thrown;
      return [];
    }),
  };
}

describe("API v1 recipe cover set-active helper guards", () => {
  const recipe = {
    id: "recipe_1",
    title: "Cover Guards",
    chefId: "chef_1",
    activeCoverId: null,
    activeCoverVariant: null,
    coverMode: "auto",
  };
  const input = { clientMutationId: "activate-cover", variant: "image" as const };
  const reservation = { id: "reservation_activate" } as never;

  it("rejects missing, archived, failed, and unavailable cover variants", async () => {
    expectFailure(await activateNativeRecipeCover(fakeSetActiveDb(null) as never, recipe, "cover_1", input, reservation), "not_found");
    expectValidationFailure(await activateNativeRecipeCover(
      fakeSetActiveDb(fakeRecipeCover({ status: "archived", archivedAt: new Date() })) as never,
      recipe,
      "cover_1",
      input,
      reservation,
    ));
    expectValidationFailure(await activateNativeRecipeCover(
      fakeSetActiveDb(fakeRecipeCover({ status: "failed" })) as never,
      recipe,
      "cover_1",
      input,
      reservation,
    ));
    expectValidationFailure(await activateNativeRecipeCover(
      fakeSetActiveDb(fakeRecipeCover({ stylizedImageUrl: null })) as never,
      recipe,
      "cover_1",
      { clientMutationId: "activate-stylized", variant: "stylized" },
      reservation,
    ));
  });

  it("maps transaction auth and unknown errors to cover failures", async () => {
    const cases: Array<[unknown, string]> = [
      [new ApiAuthError("cover missing", 404), "not_found"],
      [new ApiAuthError("cover forbidden", 403), "insufficient_scope"],
      [new ApiAuthError("bad cover", 400), "validation_error"],
      [new Error("database failed"), "validation_error"],
      ["unknown failure", "validation_error"],
    ];

    for (const [thrown, code] of cases) {
      const result = await activateNativeRecipeCover(
        fakeSetActiveDb(fakeRecipeCover(), thrown) as never,
        recipe,
        "cover_1",
        input,
        reservation,
      );
      expectFailure(result, code);
    }
  });
});

async function createCoverHelperFixture(db: LocalDb) {
  const chef = await db.user.create({ data: createTestUser() });
  const otherChef = await db.user.create({ data: createTestUser() });
  const recipe = await db.recipe.create({
    data: {
      ...createTestRecipe(chef.id),
      title: `Cover Helper ${crypto.randomUUID()}`,
    },
  });
  return { chef, otherChef, recipe };
}

async function loadNativeRecipe(db: LocalDb, chefId: string, recipeId: string) {
  return expectOk(await loadOwnedNativeRecipeCoverRecipe(db, chefId, recipeId)).data;
}

async function createReservation(db: LocalDb, userId: string, operation: string, key = crypto.randomUUID()) {
  return await db.apiIdempotencyKey.create({
    data: {
      userId,
      clientKey: `client-${key}`,
      key: `key-${key}`,
      operation,
      requestHash: `hash-${key}`,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
}

function priorFullCoverPayload(recipeId: string) {
  return {
    id: "previous_cover",
    recipeId,
    status: "ready",
    sourceType: "chef-upload",
    imageUrl: "/photos/recipes/previous.png",
    stylizedImageUrl: null,
    displayUrl: "/photos/recipes/previous.png",
    activeVariant: "image",
    provenanceLabel: "Original photo",
    sourceSpoonId: null,
    createdById: "chef_previous",
    archivedAt: null,
    generationStatus: "none",
    failureReason: null,
    sourceImageUrl: "/photos/recipes/previous.png",
    createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  };
}

async function createCoverTombstone(
  db: LocalDb,
  input: {
    reservationId: string;
    operation: string;
    coverId: string;
    recipeId: string;
    payload?: string | null;
  },
) {
  return await db.apiMutationTombstone.create({
    data: {
      idempotencyKeyId: input.reservationId,
      operation: input.operation,
      resourceType: "recipe_cover",
      resourceId: input.coverId,
      parentResourceId: input.recipeId,
      payload: input.payload,
    },
  });
}

describe("API v1 recipe cover DB helpers", () => {
  let db: LocalDb;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("covers owned recipe loading and list payload edge branches", async () => {
    const { chef, otherChef, recipe } = await createCoverHelperFixture(db);
    expectFailure(await loadOwnedNativeRecipeCoverRecipe(db, chef.id, "missing_recipe"), "not_found");
    expectFailure(await loadOwnedNativeRecipeCoverRecipe(db, otherChef.id, recipe.id), "insufficient_scope");

    const active = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/recipes/active.png",
        stylizedImageUrl: "/photos/recipes/active-stylized.png",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "succeeded",
        createdById: chef.id,
      },
    });
    await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "none",
        createdById: chef.id,
      },
    });
    await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/recipes/archived.png",
        sourceType: "chef-upload",
        status: "archived",
        generationStatus: "none",
        archivedAt: new Date(),
        createdById: chef.id,
      },
    });
    await db.recipeSpoon.create({
      data: {
        recipeId: recipe.id,
        chefId: chef.id,
        photoUrl: "/photos/spoons/finished.png",
        cookedAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    });
    await db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverId: active.id, activeCoverVariant: "stylized", coverMode: "manual" },
    });

    const nativeRecipe = await loadNativeRecipe(db, chef.id, recipe.id);
    const page = expectOk(await listNativeRecipeCovers(db, nativeRecipe, { includeArchived: false, limit: 1, offset: 0 })).data;
    expect(page.covers).toHaveLength(1);
    expect(page.pagination).toEqual({ limit: 1, offset: 0, count: 1, hasMore: true });
    expect(page.activeCover).toMatchObject({ id: active.id, activeVariant: "stylized", displayUrl: "/photos/recipes/active-stylized.png" });
    expect(page.spoonImages).toHaveLength(1);

    const inactivePage = expectOk(await listNativeRecipeCovers(
      db,
      { ...nativeRecipe, activeCoverId: null, activeCoverVariant: null },
      { includeArchived: false, limit: 1, offset: 0 },
    )).data;
    expect(inactivePage.activeCover).toBeNull();
    const missingActivePage = expectOk(await listNativeRecipeCovers(
      db,
      { ...nativeRecipe, activeCoverId: "missing_cover", activeCoverVariant: "image" },
      { includeArchived: false, limit: 1, offset: 0 },
    )).data;
    expect(missingActivePage.activeCover).toBeNull();

    const archivedPage = expectOk(await listNativeRecipeCovers(db, nativeRecipe, { includeArchived: true, limit: 50, offset: 0 })).data;
    expect(archivedPage.covers.some((cover) => cover.status === "archived")).toBe(true);
    expect(archivedPage.covers.some((cover) => cover.displayUrl === null)).toBe(true);
  });

  it("rejects archive and regenerate edge cases before mutation side effects", async () => {
    const { chef, recipe } = await createCoverHelperFixture(db);
    const active = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/recipes/active.png",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "none",
        createdById: chef.id,
      },
    });
    const replacement = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/recipes/replacement.png",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "none",
        createdById: chef.id,
      },
    });
    const archived = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/recipes/archived.png",
        sourceType: "chef-upload",
        status: "archived",
        generationStatus: "none",
        archivedAt: new Date(),
        createdById: chef.id,
      },
    });
    const imageUnavailable = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: " ",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "none",
        createdById: chef.id,
      },
    });
    const blankSource = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: " ",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "none",
        createdById: chef.id,
      },
    });
    await db.recipe.update({
      where: { id: recipe.id },
      data: { activeCoverId: active.id, activeCoverVariant: "image", coverMode: "manual" },
    });
    const nativeRecipe = await loadNativeRecipe(db, chef.id, recipe.id);
    const archiveInput = {
      clientMutationId: "archive-edge",
      replacementCoverId: null,
      replacementVariant: null,
      confirmNoCover: false,
      deleteSafeObjects: false,
    };

    expectFailure(await archiveNativeRecipeCover(db, nativeRecipe, "missing_cover", archiveInput, { id: "reservation_archive_1" } as never), "not_found");
    expectValidationFailure(await archiveNativeRecipeCover(db, nativeRecipe, active.id, {
      ...archiveInput,
      replacementCoverId: active.id,
      replacementVariant: "image",
    }, { id: "reservation_archive_2" } as never));
    expectValidationFailure(await archiveNativeRecipeCover(db, nativeRecipe, active.id, {
      ...archiveInput,
      replacementCoverId: replacement.id,
    }, { id: "reservation_archive_3" } as never));
    expectValidationFailure(await archiveNativeRecipeCover(db, nativeRecipe, active.id, {
      ...archiveInput,
      replacementCoverId: archived.id,
      replacementVariant: "image",
    }, { id: "reservation_archive_4" } as never));
    expectValidationFailure(await archiveNativeRecipeCover(db, nativeRecipe, active.id, {
      ...archiveInput,
      replacementCoverId: replacement.id,
      replacementVariant: "stylized",
    }, { id: "reservation_archive_5" } as never));
    expectValidationFailure(await archiveNativeRecipeCover(db, nativeRecipe, active.id, {
      ...archiveInput,
      replacementCoverId: imageUnavailable.id,
      replacementVariant: "image",
    }, { id: "reservation_archive_6" } as never));

    expectFailure(await regenerateNativeRecipeCover(db, {}, chef.id, nativeRecipe, {
      clientMutationId: "regenerate-missing",
      coverId: "missing_cover",
      activateWhenReady: false,
    }, { id: "reservation_regenerate_1" } as never), "not_found");
    expectValidationFailure(await regenerateNativeRecipeCover(db, {}, chef.id, nativeRecipe, {
      clientMutationId: "regenerate-blank",
      coverId: blankSource.id,
      activateWhenReady: false,
    }, { id: "reservation_regenerate_2" } as never));
    expectValidationFailure(await regenerateNativeRecipeCover(db, {}, chef.id, nativeRecipe, {
      clientMutationId: "regenerate-archived",
      coverId: archived.id,
      activateWhenReady: false,
    }, { id: "reservation_regenerate_3" } as never));
  });

  it("creates inactive URL covers and regenerates spoon covers through helper success paths", async () => {
    const { chef, recipe } = await createCoverHelperFixture(db);
    const imageKey = `recipes/${chef.id}/uploads/inactive.png`;
    const photos = createMemoryPhotosBucket([imageKey]);
    const nativeRecipe = await loadNativeRecipe(db, chef.id, recipe.id);
    const createReservationRecord = await createReservation(db, chef.id, "recipes.covers.create", "create-inactive");

    const created = expectOk(await createNativeRecipeCoverFromUrl(
      db,
      { PHOTOS: photos.bucket, OPENAI_API_KEY: "test" } as Env,
      chef.id,
      { ...nativeRecipe, activeCoverId: "missing_cover", activeCoverVariant: "image" },
      {
        clientMutationId: "create-inactive",
        imageUrl: `/photos/${imageKey}`,
        activate: false,
        generateEditorial: false,
      },
      createReservationRecord,
    )).data;
    expect(created.status).toBe(201);
    expect(created.data.nextActions).toEqual(["set_active_recipe_cover", "get_cover_generation_status"]);
    expect(created.data.blockers).toEqual([]);

    const spoonCover = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/spoons/source.png",
        sourceType: "spoon",
        status: "ready",
        generationStatus: "none",
        createdById: chef.id,
      },
    });
    const regenerateReservation = await createReservation(db, chef.id, "recipes.covers.regenerate", "regenerate-spoon");
    const regenerated = expectOk(await regenerateNativeRecipeCover(
      db,
      {},
      chef.id,
      nativeRecipe,
      {
        clientMutationId: "regenerate-spoon",
        coverId: spoonCover.id,
        activateWhenReady: false,
      },
      regenerateReservation,
    )).data;
    expect(regenerated.status).toBe(202);
    expect(regenerated.data.createdCover).toMatchObject({
      id: spoonCover.id,
      sourceType: "spoon",
      sourceImageUrl: "/photos/spoons/source.png",
      generationStatus: "failed",
      failureReason: "missing_image_provider_config",
    });
    expect(regenerated.data.blockers).toHaveLength(1);

    const quotaCover = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/recipes/quota-source.png",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "none",
        createdById: chef.id,
      },
    });
    await db.imageGenLedger.create({
      data: {
        userId: chef.id,
        kind: "stylization",
        bucketStart: startOfUtcDay(new Date()),
        count: STYLIZATION_DAILY_CAP,
      },
    });
    const quotaReservation = await createReservation(db, chef.id, "recipes.covers.regenerate", "regenerate-quota");
    const quotaRegenerated = expectOk(await regenerateNativeRecipeCover(
      db,
      { OPENAI_API_KEY: "test" } as Env,
      chef.id,
      nativeRecipe,
      {
        clientMutationId: "regenerate-quota",
        coverId: quotaCover.id,
        activateWhenReady: false,
      },
      quotaReservation,
    )).data;
    expect(quotaRegenerated.status).toBe(200);
    expect(quotaRegenerated.data.createdCover).toMatchObject({
      id: quotaCover.id,
      generationStatus: "failed",
      failureReason: "quota_exhausted",
    });
    expect(quotaRegenerated.data.blockers).toEqual([]);
    expect(quotaRegenerated.data.nextActions).toEqual(["get_cover_generation_status"]);
  });

  it("recovers cover and active cover mutations from exact tombstones", async () => {
    const { chef, otherChef, recipe } = await createCoverHelperFixture(db);
    const cover = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/recipes/recovered.png",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "failed",
        failureReason: "missing_image_provider_config",
        createdById: chef.id,
      },
    });
    const active = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/recipes/archived-recovered.png",
        sourceType: "chef-upload",
        status: "archived",
        generationStatus: "none",
        archivedAt: new Date(),
        createdById: chef.id,
      },
    });

    const coverReservation = await createReservation(db, chef.id, "recipes.covers.create", "recover-cover");
    await createCoverTombstone(db, {
      reservationId: coverReservation.id,
      operation: "recipes.covers.create",
      coverId: cover.id,
      recipeId: recipe.id,
      payload: JSON.stringify({ previousActiveCover: priorFullCoverPayload(recipe.id) }),
    });
    const recoveredCover = await recoverNativeRecipeCoverMutation(db, {}, coverReservation, {
      clientMutationId: "recover-cover",
      principalId: chef.id,
      recipeId: recipe.id,
      coverId: cover.id,
      operation: "recipes.covers.create",
      mutationKind: "cover",
    });
    expect(recoveredCover).toMatchObject({
      status: 202,
      data: {
        previousActiveCover: { id: "previous_cover" },
        createdCover: { id: cover.id, generationStatus: "failed" },
        blockers: [{ capability: "ProviderSecret", outputPath: "web/provider-secret-blocker-recipe-covers.json" }],
        nextActions: ["list_recipe_covers", "get_recipe"],
      },
    });

    const activeReservation = await createReservation(db, chef.id, "recipes.covers.archive", "recover-active");
    await createCoverTombstone(db, {
      reservationId: activeReservation.id,
      operation: "recipes.covers.archive",
      coverId: active.id,
      recipeId: recipe.id,
      payload: JSON.stringify({ previousActiveCover: { id: 42 } }),
    });
    const recoveredActive = await recoverNativeRecipeCoverMutation(db, { OPENAI_API_KEY: "test" } as Env, activeReservation, {
      clientMutationId: "recover-active",
      principalId: chef.id,
      recipeId: recipe.id,
      coverId: active.id,
      operation: "recipes.covers.archive",
      mutationKind: "active",
      expectedStatus: 204,
    });
    expect(recoveredActive).toMatchObject({
      status: 204,
      data: {
        previousActiveCover: null,
        archivedCover: { id: active.id, status: "archived" },
        blockers: [],
        nextActions: ["list_recipe_covers", "get_recipe"],
      },
    });

    const readyActiveReservation = await createReservation(db, chef.id, "recipes.covers.activate", "recover-ready-active");
    await createCoverTombstone(db, {
      reservationId: readyActiveReservation.id,
      operation: "recipes.covers.activate",
      coverId: cover.id,
      recipeId: recipe.id,
      payload: JSON.stringify({ previousActiveCover: priorFullCoverPayload(recipe.id) }),
    });
    const recoveredReadyActive = await recoverNativeRecipeCoverMutation(db, { OPENAI_API_KEY: "test" } as Env, readyActiveReservation, {
      clientMutationId: "recover-ready-active",
      principalId: chef.id,
      recipeId: recipe.id,
      coverId: cover.id,
      operation: "recipes.covers.activate",
      mutationKind: "active",
    });
    expect(recoveredReadyActive).toMatchObject({
      status: 200,
      data: {
        previousActiveCover: { id: "previous_cover" },
        archivedCover: null,
      },
    });

    const archivedAtOnly = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/recipes/archived-at-only.png",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "none",
        archivedAt: new Date(),
        createdById: chef.id,
      },
    });
    const archivedAtReservation = await createReservation(db, chef.id, "recipes.covers.archive", "recover-archived-at");
    await createCoverTombstone(db, {
      reservationId: archivedAtReservation.id,
      operation: "recipes.covers.archive",
      coverId: archivedAtOnly.id,
      recipeId: recipe.id,
      payload: null,
    });
    const recoveredArchivedAt = await recoverNativeRecipeCoverMutation(db, { OPENAI_API_KEY: "test" } as Env, archivedAtReservation, {
      clientMutationId: "recover-archived-at",
      principalId: chef.id,
      recipeId: recipe.id,
      coverId: archivedAtOnly.id,
      operation: "recipes.covers.archive",
      mutationKind: "active",
    });
    expect(recoveredArchivedAt).toMatchObject({
      data: {
        archivedCover: { id: archivedAtOnly.id, archivedAt: expect.any(String) },
      },
    });

    await expect(recoverNativeRecipeCoverMutation(db, {}, { id: "missing_reservation" } as never, {
      clientMutationId: "recover-missing",
      principalId: chef.id,
      recipeId: recipe.id,
      coverId: cover.id,
      operation: "recipes.covers.create",
      mutationKind: "cover",
    })).resolves.toBeNull();

    const mismatchReservation = await createReservation(db, chef.id, "recipes.covers.create", "recover-mismatch");
    await createCoverTombstone(db, {
      reservationId: mismatchReservation.id,
      operation: "wrong.operation",
      coverId: cover.id,
      recipeId: recipe.id,
      payload: null,
    });
    await expect(recoverNativeRecipeCoverMutation(db, {}, mismatchReservation, {
      clientMutationId: "recover-mismatch",
      principalId: chef.id,
      recipeId: recipe.id,
      coverId: cover.id,
      operation: "recipes.covers.create",
      mutationKind: "cover",
    })).resolves.toBeNull();

    const parentMismatchReservation = await createReservation(db, chef.id, "recipes.covers.create", "recover-parent-mismatch");
    await createCoverTombstone(db, {
      reservationId: parentMismatchReservation.id,
      operation: "recipes.covers.create",
      coverId: cover.id,
      recipeId: "other_recipe",
      payload: null,
    });
    await expect(recoverNativeRecipeCoverMutation(db, {}, parentMismatchReservation, {
      clientMutationId: "recover-parent-mismatch",
      principalId: chef.id,
      recipeId: recipe.id,
      coverId: cover.id,
      operation: "recipes.covers.create",
      mutationKind: "cover",
    })).resolves.toBeNull();

    const wrongOwnerReservation = await createReservation(db, chef.id, "recipes.covers.create", "recover-wrong-owner");
    await createCoverTombstone(db, {
      reservationId: wrongOwnerReservation.id,
      operation: "recipes.covers.create",
      coverId: cover.id,
      recipeId: recipe.id,
      payload: null,
    });
    await expect(recoverNativeRecipeCoverMutation(db, {}, wrongOwnerReservation, {
      clientMutationId: "recover-wrong-owner",
      principalId: otherChef.id,
      recipeId: recipe.id,
      coverId: cover.id,
      operation: "recipes.covers.create",
      mutationKind: "cover",
    })).resolves.toBeNull();

    const missingCoverReservation = await createReservation(db, chef.id, "recipes.covers.create", "recover-missing-cover");
    await createCoverTombstone(db, {
      reservationId: missingCoverReservation.id,
      operation: "recipes.covers.create",
      coverId: "missing_cover",
      recipeId: recipe.id,
      payload: null,
    });
    await expect(recoverNativeRecipeCoverMutation(db, {}, missingCoverReservation, {
      clientMutationId: "recover-missing-cover",
      principalId: chef.id,
      recipeId: recipe.id,
      coverId: "missing_cover",
      operation: "recipes.covers.create",
      mutationKind: "cover",
    })).resolves.toBeNull();
  });

  it("recovers mutations with malformed tombstone payloads as null previous covers", async () => {
    const { chef, recipe } = await createCoverHelperFixture(db);
    const cover = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/recipes/recovered.png",
        sourceType: "chef-upload",
        status: "ready",
        generationStatus: "none",
        createdById: chef.id,
      },
    });

    for (const [index, payload] of [null, "not-json", "[]"].entries()) {
      const reservation = await createReservation(db, chef.id, "recipes.covers.create", `recover-payload-${index}`);
      await createCoverTombstone(db, {
        reservationId: reservation.id,
        operation: "recipes.covers.create",
        coverId: cover.id,
        recipeId: recipe.id,
        payload,
      });
      const recovered = await recoverNativeRecipeCoverMutation(db, { OPENAI_API_KEY: "test" } as Env, reservation, {
        clientMutationId: `recover-payload-${index}`,
        principalId: chef.id,
        recipeId: recipe.id,
        coverId: cover.id,
        operation: "recipes.covers.create",
        mutationKind: "cover",
        expectedStatus: 200,
      });
      expect(recovered).toMatchObject({
        status: 200,
        data: {
          previousActiveCover: null,
          createdCover: { id: cover.id },
          nextActions: ["get_cover_generation_status"],
        },
      });
    }
  });
});
