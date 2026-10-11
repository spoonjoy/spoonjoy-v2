import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { FormData as UndiciFormData, Request as UndiciRequest } from "undici";
import { action } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { FOOD_IMAGE_TYPE_MESSAGE } from "~/lib/recipe-image";
import * as recipeSpoonModule from "~/lib/recipe-spoon.server";
import { SpoonValidationError } from "~/lib/recipe-spoon.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestUser } from "../utils";
import { expectConsoleError } from "../warning-policy";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);

function photoFile(name = "spoon.jpg", bytes: Uint8Array = JPEG_BYTES, type = "image/jpeg") {
  return new File([bytes], name, { type });
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
    } as unknown as R2Bucket & { put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> },
  };
}

type SpoonForm = {
  clientMutationId?: string;
  photo?: File | string;
  note?: string;
  nextTime?: string;
  cookedAt?: string;
  useAsRecipeCover?: string;
  extra?: string;
};

function spoonForm(input: SpoonForm) {
  const formData = new UndiciFormData();
  for (const [name, value] of Object.entries(input)) {
    if (value === undefined) continue;
    formData.append(name === "extra" ? "photoUrl" : name, value);
  }
  return formData;
}

function spoonRequest(recipeId: string, token: string, requestId: string, input: SpoonForm) {
  return new UndiciRequest(`http://localhost/api/v1/recipes/${recipeId}/spoons`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "X-Request-Id": requestId },
    body: spoonForm(input),
    duplex: "half",
  }) as unknown as Request;
}

async function createFixture(db: Awaited<ReturnType<typeof getLocalDb>>) {
  const owner = await db.user.create({ data: createTestUser() });
  const recipe = await db.recipe.create({
    data: { ...createTestRecipe(owner.id), title: `Multipart spoon ${faker.string.alphanumeric(8)}` },
  });
  const write = await createApiCredential(db, owner.id, "Spoon multipart write", { scopes: ["kitchen:write"] });
  return { owner, recipe, token: write.token };
}

describe("API v1 recipe spoon create with a multipart photo", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupDatabase();
  });

  async function post(recipeId: string, token: string, requestId: string, input: SpoonForm, env: Record<string, unknown>) {
    return await action({
      request: spoonRequest(recipeId, token, requestId, input),
      params: { "*": `recipes/${recipeId}/spoons` },
      context: backgroundContext(env),
    } as any);
  }

  it("stores the photo, creates the spoon with it, uses it as the cover, and replays by clientMutationId", async () => {
    const fixture = await createFixture(db);
    const photoBucket = mockPhotoBucket();
    const body: SpoonForm = {
      clientMutationId: "native-spoon-photo-1",
      photo: photoFile(),
      note: "  Crispy edges  ",
      nextTime: "More garlic",
      cookedAt: "2026-02-01T12:30:00.000Z",
      useAsRecipeCover: "true",
    };

    const response = await post(fixture.recipe.id, fixture.token, "req_multipart_spoon", body, { PHOTOS: photoBucket.bucket });
    const payload = await response.json() as any;

    expect(response.status).toBe(201);
    expect(photoBucket.bucket.put).toHaveBeenCalledOnce();
    const storedKey = photoBucket.bucket.put.mock.calls[0][0] as string;
    expect(storedKey.startsWith(`spoons/${fixture.owner.id}/${fixture.recipe.id}/`)).toBe(true);
    expect(payload).toMatchObject({
      ok: true,
      requestId: "req_multipart_spoon",
      data: {
        spoon: expect.objectContaining({
          id: expect.any(String),
          chefId: fixture.owner.id,
          recipeId: fixture.recipe.id,
          cookedAt: "2026-02-01T12:30:00.000Z",
          photoUrl: `https://spoonjoy.app/photos/${storedKey}`,
          note: "Crispy edges",
          nextTime: "More garlic",
        }),
        isOriginCook: true,
        createdCover: expect.objectContaining({ sourceType: "spoon" }),
        mutation: { clientMutationId: "native-spoon-photo-1", replayed: false },
      },
    });
    const spoon = await db.recipeSpoon.findUniqueOrThrow({ where: { id: payload.data.spoon.id } });
    expect(spoon.photoUrl).toBe(`/photos/${storedKey}`);
    const recipe = await db.recipe.findUniqueOrThrow({ where: { id: fixture.recipe.id } });
    expect(recipe.activeCoverId).toBe(payload.data.createdCover.id);

    const replay = await post(fixture.recipe.id, fixture.token, "req_multipart_spoon_replay", { ...body, photo: photoFile() }, { PHOTOS: photoBucket.bucket });
    expect(replay.status).toBe(201);
    await expect(replay.json()).resolves.toMatchObject({
      data: {
        spoon: { id: payload.data.spoon.id },
        mutation: { clientMutationId: "native-spoon-photo-1", replayed: true },
      },
    });
    expect(photoBucket.bucket.put).toHaveBeenCalledOnce();

    const conflict = await post(fixture.recipe.id, fixture.token, "req_multipart_spoon_conflict", {
      ...body,
      photo: photoFile("other.png", PNG_BYTES, "image/png"),
    }, { PHOTOS: photoBucket.bucket });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ error: { code: "idempotency_conflict" } });
    await expect(db.recipeSpoon.count({ where: { recipeId: fixture.recipe.id } })).resolves.toBe(1);
  });

  it("accepts the photo alone, takes clientMutationId from the header, and leaves the cover unless asked", async () => {
    const fixture = await createFixture(db);
    await db.recipe.update({ where: { id: fixture.recipe.id }, data: { chefId: (await db.user.create({ data: createTestUser() })).id } });
    const photoBucket = mockPhotoBucket();
    const request = new UndiciRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fixture.token}`,
        "X-Request-Id": "req_multipart_spoon_header",
        "X-Client-Mutation-Id": "native-spoon-photo-header",
      },
      body: spoonForm({ photo: photoFile("dish.png", PNG_BYTES, "image/png") }),
      duplex: "half",
    }) as unknown as Request;

    const response = await action({
      request,
      params: { "*": `recipes/${fixture.recipe.id}/spoons` },
      context: backgroundContext({ PHOTOS: photoBucket.bucket }),
    } as any);
    const payload = await response.json() as any;

    expect(response.status).toBe(201);
    expect(payload.data).toMatchObject({
      spoon: { note: null, nextTime: null, photoUrl: expect.stringContaining(`/photos/spoons/${fixture.owner.id}/${fixture.recipe.id}/`) },
      isOriginCook: false,
      createdCover: null,
      mutation: { clientMutationId: "native-spoon-photo-header", replayed: false },
    });
  });

  it.each([
    ["a missing photo", { clientMutationId: "m-missing" }, "Please select a photo to upload"],
    ["an empty photo", { clientMutationId: "m-empty", photo: photoFile("empty.jpg", new Uint8Array(), "image/jpeg") }, "Please select a photo to upload"],
    ["a photo sent as text", { clientMutationId: "m-text", photo: "not a file" }, "Please select a photo to upload"],
    ["a photo whose bytes are not its type", { clientMutationId: "m-type", photo: photoFile("fake.jpg", PNG_BYTES, "image/jpeg") }, FOOD_IMAGE_TYPE_MESSAGE],
    ["a photoUrl field", { clientMutationId: "m-unknown", photo: photoFile(), extra: "/photos/x.jpg" }, "Unknown request body fields"],
    ["a non-boolean useAsRecipeCover", { clientMutationId: "m-bool", photo: photoFile(), useAsRecipeCover: "yes" }, "useAsRecipeCover must be true or false"],
    ["a bad cookedAt", { clientMutationId: "m-date", photo: photoFile(), cookedAt: "yesterday" }, "cookedAt"],
    ["a missing clientMutationId", { photo: photoFile() }, "clientMutationId"],
  ] as Array<[string, SpoonForm, string]>)("rejects %s without storing anything", async (_label, input, message) => {
    const fixture = await createFixture(db);
    const photoBucket = mockPhotoBucket();

    const response = await post(fixture.recipe.id, fixture.token, "req_multipart_invalid", input, { PHOTOS: photoBucket.bucket });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error", message: expect.stringContaining(message) },
    });
    expect(photoBucket.bucket.put).not.toHaveBeenCalled();
    await expect(db.recipeSpoon.count()).resolves.toBe(0);
  });

  it("still reads a request with no Content-Type as an empty JSON body", async () => {
    const fixture = await createFixture(db);

    const response = await action({
      request: new UndiciRequest(`http://localhost/api/v1/recipes/${fixture.recipe.id}/spoons`, {
        method: "POST",
        headers: { Authorization: `Bearer ${fixture.token}`, "X-Request-Id": "req_spoon_no_content_type" },
      }) as unknown as Request,
      params: { "*": `recipes/${fixture.recipe.id}/spoons` },
      context: backgroundContext(),
    } as any);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error", message: "clientMutationId must be a nonblank string" },
    });
  });

  it("answers not found for a missing recipe without storing the photo", async () => {
    const fixture = await createFixture(db);
    const photoBucket = mockPhotoBucket();

    const response = await post("missing-recipe", fixture.token, "req_multipart_missing_recipe", {
      clientMutationId: "m-missing-recipe",
      photo: photoFile(),
    }, { PHOTOS: photoBucket.bucket });

    expect(response.status).toBe(404);
    expect(photoBucket.bucket.put).not.toHaveBeenCalled();
  });

  it("deletes the stored photo and frees the clientMutationId when the spoon is not written", async () => {
    const fixture = await createFixture(db);
    const photoBucket = mockPhotoBucket();
    const createSpy = vi.spyOn(recipeSpoonModule, "createSpoon").mockRejectedValueOnce(new SpoonValidationError("Spoon refused"));
    const body: SpoonForm = { clientMutationId: "m-create-fails", photo: photoFile() };

    const failed = await post(fixture.recipe.id, fixture.token, "req_multipart_create_fails", body, { PHOTOS: photoBucket.bucket });

    expect(failed.status).toBe(400);
    await expect(failed.json()).resolves.toMatchObject({ error: { code: "validation_error", message: "Spoon refused" } });
    expect(photoBucket.bucket.put).toHaveBeenCalledOnce();
    expect(photoBucket.bucket.delete).toHaveBeenCalledWith(photoBucket.bucket.put.mock.calls[0][0]);
    expect(photoBucket.keys.size).toBe(0);

    createSpy.mockRestore();
    const retry = await post(fixture.recipe.id, fixture.token, "req_multipart_create_retry", { ...body, photo: photoFile() }, { PHOTOS: photoBucket.bucket });
    expect(retry.status).toBe(201);
    await expect(retry.json()).resolves.toMatchObject({ data: { mutation: { replayed: false } } });
    expect(photoBucket.keys.size).toBe(1);
  });

  it("keeps the photo and answers with the spoon when the spoon was written before the error", async () => {
    const fixture = await createFixture(db);
    const photoBucket = mockPhotoBucket();
    const realCreateSpoon = recipeSpoonModule.createSpoon;
    const lostAck = new Error("connection lost after commit");
    vi.spyOn(recipeSpoonModule, "createSpoon").mockImplementationOnce(async (...callArgs) => {
      await realCreateSpoon(...callArgs);
      throw lostAck;
    });

    const response = await post(fixture.recipe.id, fixture.token, "req_multipart_lost_ack", {
      clientMutationId: "m-lost-ack",
      photo: photoFile(),
    }, { PHOTOS: photoBucket.bucket });

    expect(response.status).toBe(201);
    const payload = await response.json() as any;
    expect(payload.data).toMatchObject({ spoon: { id: expect.any(String) }, mutation: { clientMutationId: "m-lost-ack" } });
    expect(photoBucket.bucket.delete).not.toHaveBeenCalled();
    expect(photoBucket.keys.size).toBe(1);
  });

  it("keeps the photo when it cannot tell whether the spoon was written", async () => {
    const fixture = await createFixture(db);
    const photoBucket = mockPhotoBucket();
    vi.spyOn(recipeSpoonModule, "createSpoon").mockRejectedValueOnce(new SpoonValidationError("Spoon refused"));
    const originalFindFirst = db.recipeSpoon.findFirst;
    db.recipeSpoon.findFirst = vi.fn().mockRejectedValue(new Error("read failed")) as unknown as typeof db.recipeSpoon.findFirst;

    try {
      const response = await post(fixture.recipe.id, fixture.token, "req_multipart_unknown_write", {
        clientMutationId: "m-unknown-write",
        photo: photoFile(),
      }, { PHOTOS: photoBucket.bucket });

      expect(response.status).toBe(400);
      expect(photoBucket.bucket.delete).not.toHaveBeenCalled();
      expect(photoBucket.keys.size).toBe(1);
    } finally {
      db.recipeSpoon.findFirst = originalFindFirst;
    }
  });

  it("reports an unexpected failure as an internal error after cleaning up", async () => {
    const fixture = await createFixture(db);
    const photoBucket = mockPhotoBucket();
    const failure = new Error("database exploded");
    vi.spyOn(recipeSpoonModule, "createSpoon").mockRejectedValueOnce(failure);
    expectConsoleError("[api-v1] internal_error", {
      requestId: "req_multipart_internal",
      method: "POST",
      path: `/api/v1/recipes/${fixture.recipe.id}/spoons`,
      error: { name: failure.name, message: failure.message, stack: failure.stack },
    });

    const response = await post(fixture.recipe.id, fixture.token, "req_multipart_internal", {
      clientMutationId: "m-internal",
      photo: photoFile(),
    }, { PHOTOS: photoBucket.bucket });

    expect(response.status).toBe(500);
    expect(photoBucket.keys.size).toBe(0);
  });
});
