import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { getLocalDb } from "~/lib/db.server";
import {
  __internal__,
  callSpoonjoyApiOperation,
  listSpoonjoyApiOperations,
  type SpoonjoyApiContext,
} from "~/lib/spoonjoy-api.server";
import type { ApiPrincipal } from "~/lib/api-auth.server";
import { cleanupDatabase } from "../helpers/cleanup";

type Database = Awaited<ReturnType<typeof getLocalDb>>;

const GENERATED_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const VALID_PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function mockR2(): R2Bucket {
  const stored = new Map<string, { value: unknown; httpMetadata?: { contentType?: string } }>();
  return {
    put: vi.fn(async (key: string, _value: unknown, options?: { httpMetadata?: { contentType?: string } }) => {
      stored.set(key, { value: _value, httpMetadata: options?.httpMetadata });
      return {};
    }),
    delete: vi.fn(async (key: string) => {
      stored.delete(key);
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
    head: vi.fn(async (key: string) => stored.has(key)
      ? ({ key, httpMetadata: stored.get(key)?.httpMetadata })
      : null),
    list: vi.fn(),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
  } as unknown as R2Bucket;
}

function uniqueEmail(prefix = "chef") {
  return `${prefix}-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
}

function uniqueUsername(prefix = "user") {
  return `${prefix}_${faker.string.alphanumeric(8).toLowerCase()}`;
}

async function makeUser(db: Database, source = "bearer" as ApiPrincipal["source"]) {
  const user = await db.user.create({
    data: { email: uniqueEmail(), username: uniqueUsername() },
  });
  const principal: ApiPrincipal = {
    id: user.id,
    email: user.email,
    username: user.username,
    source,
    scopes: ["cookbooks:read", "public:read", "recipes:read", "shopping_list:read", "shopping_list:write", "tokens:read", "tokens:write", "kitchen:read", "kitchen:write"],
  };
  return { user, principal };
}

async function makeRecipe(db: Database, chefId: string) {
  return db.recipe.create({
    data: {
      title: `Spoon Test ${faker.string.alphanumeric(6)}`,
      description: "test",
      chefId,
    },
  });
}

describe("spoonjoy-api spoon operations", () => {
  let db: Database;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("operation registry", () => {
    it("lists the five new spoon operations", () => {
      const names = listSpoonjoyApiOperations().map((op) => op.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "upload_recipe_image",
          "upload_spoon_photo",
          "create_spoon",
          "update_spoon",
          "delete_spoon",
          "list_spoons_for_recipe",
          "list_spoons_by_chef",
        ]),
      );
    });

    it("enforces defensive schema edges for unknown nested arguments", () => {
      expect(() => __internal__.assertNoUnknownArguments(
        { type: "object", additionalProperties: false },
        { unexpected: true },
        "test_tool",
      )).toThrow("test_tool.unexpected is not allowed");

      expect(() => __internal__.assertNoUnknownArguments(
        {
          type: "object",
          properties: { allowed: { type: "string" } },
        },
        { allowed: "yes", ignoredBySchema: true },
        "test_tool",
      )).not.toThrow();

      expect(() => __internal__.assertNoUnknownArguments(
        { type: "array" },
        [{ ignored: true }],
        "test_tool.items",
      )).not.toThrow();
    });
  });

  describe("image upload operations", () => {
    it("requires kitchen:write for upload tools", async () => {
      const { principal } = await makeUser(db);
      const context: SpoonjoyApiContext = {
        db,
        principal: { ...principal, scopes: ["kitchen:read"] },
        bucket: mockR2(),
      };

      await expect(callSpoonjoyApiOperation("upload_recipe_image", {
        imageBase64: Buffer.from(VALID_PNG_BYTES).toString("base64"),
        mimeType: "image/png",
        filename: "raw.png",
      }, context)).rejects.toMatchObject({
        status: 403,
        message: "Missing required scope: kitchen:write",
      });
    });

    it("stores recipe and spoon upload bytes through the shared validator", async () => {
      const { principal } = await makeUser(db);
      const bucket = mockR2();
      const context: SpoonjoyApiContext = { db, principal, bucket };

      const recipeUpload = await callSpoonjoyApiOperation("upload_recipe_image", {
        imageBase64: Buffer.from(VALID_PNG_BYTES).toString("base64"),
        mimeType: "image/png",
        filename: "raw.png",
      }, context) as { imageUrl: string; sizeBytes: number; mimeType: string };
      expect(recipeUpload).toMatchObject({
        imageUrl: expect.stringMatching(new RegExp(`^/photos/recipes/${principal.id}/uploads/\\d+-[a-f0-9-]+\\.png$`)),
        mimeType: "image/png",
        sizeBytes: VALID_PNG_BYTES.length,
      });

      const spoonUpload = await callSpoonjoyApiOperation("upload_spoon_photo", {
        imageBase64: Buffer.from(VALID_PNG_BYTES).toString("base64"),
        mimeType: "image/png",
        filename: "raw.png",
      }, context) as { imageUrl: string; sizeBytes: number; mimeType: string };
      expect(spoonUpload.imageUrl).toMatch(new RegExp(`^/photos/spoons/${principal.id}/uploads/\\d+-[a-f0-9-]+\\.png$`));
      expect(bucket.put).toHaveBeenCalledTimes(2);
    });

    it("rejects GIF upload bytes and missing buckets without explicit local fallback", async () => {
      const { principal } = await makeUser(db);
      await expect(callSpoonjoyApiOperation("upload_spoon_photo", {
        imageBase64: Buffer.from([0x47, 0x49, 0x46, 0x38, 1, 2, 3]).toString("base64"),
        mimeType: "image/png",
        filename: "raw.png",
      }, { db, principal, bucket: mockR2() })).rejects.toThrow("Photos must be JPG, PNG, or WebP.");

      await expect(callSpoonjoyApiOperation("upload_recipe_image", {
        imageBase64: Buffer.from(VALID_PNG_BYTES).toString("base64"),
        mimeType: "image/png",
        filename: "raw.png",
      }, { db, principal })).rejects.toMatchObject({
        status: 503,
        message: "Image uploads require the PHOTOS bucket.",
      });
    });
  });

  describe("create_spoon", () => {
    it("round-trips explicit local spoon photo data URLs through create and update stylization", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const uploaded = await callSpoonjoyApiOperation("upload_spoon_photo", {
        imageBase64: Buffer.from(VALID_PNG_BYTES).toString("base64"),
        mimeType: "image/png",
        filename: "raw.png",
      }, { db, principal: chef, allowLocalImageFallback: true }) as { imageUrl: string };
      const captured: Promise<unknown>[] = [];
      const runner = {
        textToImage: vi.fn(),
        imageToImage: vi.fn().mockResolvedValue({ bytes: GENERATED_BYTES, contentType: "image/png" }),
      };
      const context: SpoonjoyApiContext = {
        db,
        principal: chef,
        allowLocalImageFallback: true,
        imageGenRunner: runner,
        waitUntil: (p) => captured.push(p),
      };

      const created = await callSpoonjoyApiOperation("create_spoon", {
        recipeId: recipe.id,
        photoUrl: uploaded.imageUrl,
      }, context) as { spoon: { id: string; photoUrl: string }; cover: { id: string; imageUrl: string } };

      expect(created.spoon.photoUrl).toBe(`data:image/png;base64,${Buffer.from(VALID_PNG_BYTES).toString("base64")}`);
      expect(created.cover.imageUrl).toBe(created.spoon.photoUrl);
      expect(captured).toHaveLength(1);
      await captured[0];
      let cover = await db.recipeCover.findUniqueOrThrow({ where: { id: created.cover.id } });
      expect(cover.stylizedImageUrl).toBe(`data:image/png;base64,${Buffer.from(GENERATED_BYTES).toString("base64")}`);

      const updated = await callSpoonjoyApiOperation("update_spoon", {
        spoonId: created.spoon.id,
        photoUrl: uploaded.imageUrl,
      }, context) as { cover: { id: string; imageUrl: string } };

      expect(updated.cover.imageUrl).toBe(uploaded.imageUrl);
      expect(captured).toHaveLength(2);
      await captured[1];
      cover = await db.recipeCover.findUniqueOrThrow({ where: { id: updated.cover.id } });
      expect(cover.stylizedImageUrl).toBe(`data:image/png;base64,${Buffer.from(GENERATED_BYTES).toString("base64")}`);
      expect(runner.imageToImage).toHaveBeenCalledTimes(2);
    });

    it("creates a spoon with note for the principal when not the recipe owner", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: cook } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);

      const context: SpoonjoyApiContext = { db, principal: cook };
      const result = (await callSpoonjoyApiOperation(
        "create_spoon",
        { recipeId: recipe.id, note: "nice" },
        context,
      )) as { spoon: { id: string; chefId: string; note: string }; isOriginCook: boolean };

      expect(result.spoon.chefId).toBe(cook.id);
      expect(result.spoon.note).toBe("nice");
      expect(result.isOriginCook).toBe(false);
    });

    it("rejects when ownerEmail is supplied with the documented 400 message", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const context: SpoonjoyApiContext = { db, principal: chef };

      await expect(
        callSpoonjoyApiOperation(
          "create_spoon",
          { recipeId: recipe.id, ownerEmail: "evil@example.com", note: "x" },
          context,
        ),
      ).rejects.toMatchObject({
        message: "ownerEmail is not supported on this op; use API token",
        status: 400,
      });
    });

    it("rejects unauthenticated callers with 401", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const context: SpoonjoyApiContext = { db, principal: null };

      await expect(
        callSpoonjoyApiOperation(
          "create_spoon",
          { recipeId: recipe.id, note: "x" },
          context,
        ),
      ).rejects.toMatchObject({ status: 401 });
    });

    it("forwards validation errors as 400 when content is empty", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: cook } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const context: SpoonjoyApiContext = { db, principal: cook };

      await expect(
        callSpoonjoyApiOperation(
          "create_spoon",
          { recipeId: recipe.id },
          context,
        ),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("enforces origin-cook photo requirement with 400", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const context: SpoonjoyApiContext = { db, principal: chef };

      await expect(
        callSpoonjoyApiOperation(
          "create_spoon",
          { recipeId: recipe.id, note: "looks good" },
          context,
        ),
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/photo/i),
      });
    });

    it("accepts cookedAt as an ISO date string", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: cook } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const context: SpoonjoyApiContext = { db, principal: cook };
      const result = (await callSpoonjoyApiOperation(
        "create_spoon",
        {
          recipeId: recipe.id,
          note: "x",
          cookedAt: "2025-06-01T12:00:00.000Z",
        },
        context,
      )) as { spoon: { cookedAt: string } };
      expect(result.spoon.cookedAt).toBe("2025-06-01T12:00:00.000Z");
    });

    it("rejects invalid cookedAt strings", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: cook } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const context: SpoonjoyApiContext = { db, principal: cook };
      await expect(
        callSpoonjoyApiOperation(
          "create_spoon",
          { recipeId: recipe.id, note: "x", cookedAt: "not-a-date" },
          context,
        ),
      ).rejects.toThrow(/cookedAt/);
    });

    it("requires recipeId", async () => {
      const { principal: chef } = await makeUser(db);
      const context: SpoonjoyApiContext = { db, principal: chef };
      await expect(
        callSpoonjoyApiOperation("create_spoon", {}, context),
      ).rejects.toMatchObject({ message: expect.stringMatching(/recipeId/i) });
    });

    it("accepts photoUrl as a fallback when no upload bucket is wired", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const context: SpoonjoyApiContext = { db, principal: chef };
      const result = (await callSpoonjoyApiOperation(
        "create_spoon",
        {
          recipeId: recipe.id,
          photoUrl: "https://stub.test/x.png",
        },
        context,
      )) as { spoon: { photoUrl: string }; isOriginCook: boolean };

      expect(result.spoon.photoUrl).toBe("https://stub.test/x.png");
      expect(result.isOriginCook).toBe(true);
    });

    it("on origin-cook with photoUrl, inserts a RecipeCover row with sourceType='spoon' synchronously", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const context: SpoonjoyApiContext = { db, principal: chef };

      const result = (await callSpoonjoyApiOperation(
        "create_spoon",
        { recipeId: recipe.id, photoUrl: "https://stub.test/raw.png" },
        context,
      )) as { spoon: { id: string }; cover: { id: string } | null };

      const covers = await db.recipeCover.findMany({ where: { recipeId: recipe.id } });
      expect(covers).toHaveLength(1);
      expect(covers[0]).toMatchObject({
        sourceType: "spoon",
        sourceSpoonId: result.spoon.id,
        imageUrl: "https://stub.test/raw.png",
        stylizedImageUrl: null,
      });
      expect(result.cover?.id).toBe(covers[0].id);
    });

    it("does NOT insert a RecipeCover when chef is not the origin cook", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: cook } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const context: SpoonjoyApiContext = { db, principal: cook };

      const result = (await callSpoonjoyApiOperation(
        "create_spoon",
        { recipeId: recipe.id, photoUrl: "https://stub.test/raw.png" },
        context,
      )) as { cover: unknown };

      const covers = await db.recipeCover.findMany({ where: { recipeId: recipe.id } });
      expect(covers).toHaveLength(0);
      expect(result.cover).toBeNull();
    });

    it("schedules stylization via context.waitUntil; await fills stylizedImageUrl", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const bucket = mockR2();
      const uploaded = await callSpoonjoyApiOperation("upload_spoon_photo", {
        imageBase64: Buffer.from(VALID_PNG_BYTES).toString("base64"),
        mimeType: "image/png",
        filename: "raw.png",
      }, { db, principal: chef, bucket }) as { imageUrl: string };
      const photoUrl = uploaded.imageUrl;
      const captured: Promise<unknown>[] = [];
      const waitUntil = vi.fn((promise: Promise<unknown>) => {
        captured.push(promise);
      });
      const runner = {
        textToImage: vi.fn().mockResolvedValue({ bytes: GENERATED_BYTES, contentType: "image/png" }),
        imageToImage: vi.fn().mockResolvedValue({ bytes: GENERATED_BYTES, contentType: "image/png" }),
      };
      const context: SpoonjoyApiContext = {
        db,
        principal: chef,
        waitUntil,
        bucket,
        imageGenRunner: runner,
      };

      const result = (await callSpoonjoyApiOperation(
        "create_spoon",
        { recipeId: recipe.id, photoUrl },
        context,
      )) as { cover: { id: string } };

      expect(waitUntil).toHaveBeenCalledTimes(1);
      expect(captured).toHaveLength(1);
      await captured[0];

      const updatedCover = await db.recipeCover.findUniqueOrThrow({
        where: { id: result.cover.id },
      });
      expect(updatedCover.stylizedImageUrl).toMatch(/^\/photos\/covers\/\d+-[a-f0-9-]+\.png$/);
      expect(bucket.put).toHaveBeenCalledWith(
        updatedCover.stylizedImageUrl!.replace("/photos/", ""),
        GENERATED_BYTES,
        expect.objectContaining({ httpMetadata: { contentType: "image/png" } }),
      );
      expect(runner.imageToImage).toHaveBeenCalledTimes(1);
      const sourceFile = runner.imageToImage.mock.calls[0][0] as File;
      expect(sourceFile.type).toBe("image/png");
    });

    it("when no waitUntil is provided, runs stylization inline and fills stylizedImageUrl", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const bucket = mockR2();
      const uploaded = await callSpoonjoyApiOperation("upload_spoon_photo", {
        imageBase64: Buffer.from(VALID_PNG_BYTES).toString("base64"),
        mimeType: "image/png",
        filename: "raw.png",
      }, { db, principal: chef, bucket }) as { imageUrl: string };
      const photoUrl = uploaded.imageUrl;
      const runner = {
        textToImage: vi.fn().mockResolvedValue({ bytes: GENERATED_BYTES, contentType: "image/png" }),
        imageToImage: vi.fn().mockResolvedValue({ bytes: GENERATED_BYTES, contentType: "image/png" }),
      };
      const context: SpoonjoyApiContext = {
        db,
        principal: chef,
        bucket,
        imageGenRunner: runner,
      };

      const result = (await callSpoonjoyApiOperation(
        "create_spoon",
        { recipeId: recipe.id, photoUrl },
        context,
      )) as { cover: { id: string } };

      const updatedCover = await db.recipeCover.findUniqueOrThrow({
        where: { id: result.cover.id },
      });
      expect(updatedCover.stylizedImageUrl).toMatch(/^\/photos\/covers\/\d+-[a-f0-9-]+\.png$/);
      expect(bucket.put).toHaveBeenCalledWith(
        updatedCover.stylizedImageUrl!.replace("/photos/", ""),
        GENERATED_BYTES,
        expect.objectContaining({ httpMetadata: { contentType: "image/png" } }),
      );
    });

    it("when stylization quota is exceeded, cover row is left with stylizedImageUrl=null and ledger does not exceed cap", async () => {
      const { user, principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const today = new Date();
      const bucketStart = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
      );
      await db.imageGenLedger.create({
        data: { userId: user.id, kind: "stylization", bucketStart, count: 50 },
      });
      const runner = {
        textToImage: vi.fn(),
        imageToImage: vi.fn(),
      };
      const context: SpoonjoyApiContext = {
        db,
        principal: chef,
        imageGenRunner: runner,
      };

      const result = (await callSpoonjoyApiOperation(
        "create_spoon",
        { recipeId: recipe.id, photoUrl: "https://stub.test/cap.png" },
        context,
      )) as { cover: { id: string } };

      const cover = await db.recipeCover.findUniqueOrThrow({
        where: { id: result.cover.id },
      });
      expect(cover.stylizedImageUrl).toBeNull();
      expect(runner.imageToImage).not.toHaveBeenCalled();

      const ledger = await db.imageGenLedger.findUniqueOrThrow({
        where: {
          userId_kind_bucketStart: {
            userId: user.id,
            kind: "stylization",
            bucketStart,
          },
        },
      });
      expect(ledger.count).toBe(50);
    });

    it("when stylization throws, cover row stays with stylizedImageUrl=null and error is logged", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const bucket = mockR2();
      const uploaded = await callSpoonjoyApiOperation("upload_spoon_photo", {
        imageBase64: Buffer.from(VALID_PNG_BYTES).toString("base64"),
        mimeType: "image/png",
        filename: "raw.png",
      }, { db, principal: chef, bucket }) as { imageUrl: string };
      const runner = {
        textToImage: vi.fn().mockRejectedValue(new Error("openai down")),
        imageToImage: vi.fn().mockRejectedValue(new Error("openai down")),
      };
      const logger = { error: vi.fn() };
      const context: SpoonjoyApiContext = {
        db,
        principal: chef,
        bucket,
        imageGenRunner: runner,
        logger,
      };

      const result = (await callSpoonjoyApiOperation(
        "create_spoon",
        { recipeId: recipe.id, photoUrl: uploaded.imageUrl },
        context,
      )) as { cover: { id: string } };

      const cover = await db.recipeCover.findUniqueOrThrow({
        where: { id: result.cover.id },
      });
      expect(cover.stylizedImageUrl).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });

    it("writes a NotificationEvent for the recipe owner when the spooner is not the owner (with VAPID env)", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: cook } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const captured: Promise<unknown>[] = [];
      const context: SpoonjoyApiContext = {
        db,
        principal: cook,
        waitUntil: (p) => captured.push(p),
        env: {
          VAPID_PUBLIC_KEY: "pub",
          VAPID_PRIVATE_KEY: "priv",
          VAPID_SUBJECT: "mailto:test@example.com",
        },
      };
      await callSpoonjoyApiOperation(
        "create_spoon",
        { recipeId: recipe.id, note: "yum" },
        context,
      );
      await Promise.all(captured);
      const events = await db.notificationEvent.findMany({
        where: { recipientId: chef.id, kind: "spoon_on_my_recipe" },
      });
      expect(events).toHaveLength(1);
    });

    it("does NOT write a NotificationEvent when the spooner IS the owner", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      // Seed a prior spoon so this owner spoon isn't an origin-cook.
      await db.recipeSpoon.create({
        data: { chefId: chef.id, recipeId: recipe.id, note: "seed" },
      });
      const captured: Promise<unknown>[] = [];
      await callSpoonjoyApiOperation(
        "create_spoon",
        { recipeId: recipe.id, note: "self" },
        {
          db,
          principal: chef,
          waitUntil: (p) => captured.push(p),
          env: {
            VAPID_PUBLIC_KEY: "pub",
            VAPID_PRIVATE_KEY: "priv",
            VAPID_SUBJECT: "mailto:test@example.com",
          },
        },
      );
      await Promise.all(captured);
      const count = await db.notificationEvent.count();
      expect(count).toBe(0);
    });

    it("does not write a NotificationEvent when VAPID env is absent (graceful skip)", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: cook } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const captured: Promise<unknown>[] = [];
      await callSpoonjoyApiOperation(
        "create_spoon",
        { recipeId: recipe.id, note: "no-vapid" },
        {
          db,
          principal: cook,
          waitUntil: (p) => captured.push(p),
          env: null,
        },
      );
      await Promise.all(captured);
      const events = await db.notificationEvent.count();
      expect(events).toBe(0);
    });

    it("fans out fellow_chef_origin_cook to each fellow chef on an origin-cook spoon", async () => {
      // spooner has previously cooked recipes owned by fellowA + fellowB.
      const { principal: spooner } = await makeUser(db);
      const { principal: fellowA } = await makeUser(db);
      const { principal: fellowB } = await makeUser(db);
      const recipeA = await makeRecipe(db, fellowA.id);
      const recipeB = await makeRecipe(db, fellowB.id);
      await db.recipeSpoon.create({
        data: { chefId: spooner.id, recipeId: recipeA.id, note: "y" },
      });
      await db.recipeSpoon.create({
        data: { chefId: spooner.id, recipeId: recipeB.id, note: "y" },
      });
      // Spooner's own new recipe (no prior spoons => origin-cook candidate).
      const ownRecipe = await makeRecipe(db, spooner.id);

      const captured: Promise<unknown>[] = [];
      await callSpoonjoyApiOperation(
        "create_spoon",
        { recipeId: ownRecipe.id, photoUrl: "https://stub.test/p.png" },
        {
          db,
          principal: spooner,
          waitUntil: (p) => captured.push(p),
          env: {
            VAPID_PUBLIC_KEY: "pub",
            VAPID_PRIVATE_KEY: "priv",
            VAPID_SUBJECT: "mailto:test@example.com",
          },
        },
      );
      await Promise.all(captured);

      const events = await db.notificationEvent.findMany({
        where: { kind: "fellow_chef_origin_cook" },
      });
      expect(events).toHaveLength(2);
      const recipients = new Set(events.map((e) => e.recipientId));
      expect(recipients.has(fellowA.id)).toBe(true);
      expect(recipients.has(fellowB.id)).toBe(true);
    });

    it("does NOT fan out fellow_chef_origin_cook on a non-origin spoon", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: cook } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      // Pre-seed a non-deleted spoon for the cook so this isn't an origin cook by the cook's perspective.
      await db.recipeSpoon.create({
        data: { chefId: cook.id, recipeId: recipe.id, note: "prior" },
      });
      const captured: Promise<unknown>[] = [];
      await callSpoonjoyApiOperation(
        "create_spoon",
        { recipeId: recipe.id, note: "second" },
        {
          db,
          principal: cook,
          waitUntil: (p) => captured.push(p),
          env: {
            VAPID_PUBLIC_KEY: "pub",
            VAPID_PRIVATE_KEY: "priv",
            VAPID_SUBJECT: "mailto:test@example.com",
          },
        },
      );
      await Promise.all(captured);
      const fanoutEvents = await db.notificationEvent.count({
        where: { kind: "fellow_chef_origin_cook" },
      });
      expect(fanoutEvents).toBe(0);
    });
  });

  describe("update_spoon", () => {
    it("allows the owning principal to update their spoon", async () => {
      const { principal: cook } = await makeUser(db);
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const created = await db.recipeSpoon.create({
        data: { chefId: cook.id, recipeId: recipe.id, note: "first" },
      });

      const context: SpoonjoyApiContext = { db, principal: cook };
      const result = (await callSpoonjoyApiOperation(
        "update_spoon",
        { spoonId: created.id, note: "second" },
        context,
      )) as { spoon: { id: string; note: string } };

      expect(result.spoon.note).toBe("second");
    });

    it("rejects update from a non-owner with 403", async () => {
      const { principal: cook } = await makeUser(db);
      const { principal: stranger } = await makeUser(db);
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const created = await db.recipeSpoon.create({
        data: { chefId: cook.id, recipeId: recipe.id, note: "first" },
      });
      const context: SpoonjoyApiContext = { db, principal: stranger };

      await expect(
        callSpoonjoyApiOperation(
          "update_spoon",
          { spoonId: created.id, note: "hijack" },
          context,
        ),
      ).rejects.toMatchObject({ status: 403 });
    });

    it("rejects update on soft-deleted spoon with 404", async () => {
      const { principal: cook } = await makeUser(db);
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const created = await db.recipeSpoon.create({
        data: {
          chefId: cook.id,
          recipeId: recipe.id,
          note: "first",
          deletedAt: new Date(),
        },
      });
      const context: SpoonjoyApiContext = { db, principal: cook };
      await expect(
        callSpoonjoyApiOperation(
          "update_spoon",
          { spoonId: created.id, note: "late" },
          context,
        ),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("rejects when ownerEmail is supplied", async () => {
      const { principal: cook } = await makeUser(db);
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const created = await db.recipeSpoon.create({
        data: { chefId: cook.id, recipeId: recipe.id, note: "first" },
      });
      const context: SpoonjoyApiContext = { db, principal: cook };
      await expect(
        callSpoonjoyApiOperation(
          "update_spoon",
          { spoonId: created.id, ownerEmail: "e", note: "x" },
          context,
        ),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("accepts nextTime/photoUrl/cookedAt patches", async () => {
      const { principal: cook } = await makeUser(db);
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const created = await db.recipeSpoon.create({
        data: {
          chefId: cook.id,
          recipeId: recipe.id,
          note: "first",
          photoUrl: "/photos/old.png",
        },
      });
      const context: SpoonjoyApiContext = { db, principal: cook };
      const result = (await callSpoonjoyApiOperation(
        "update_spoon",
        {
          spoonId: created.id,
          nextTime: "salt more",
          photoUrl: "https://stub.test/new.png",
          cookedAt: "2025-06-02T00:00:00.000Z",
        },
        context,
      )) as { spoon: { nextTime: string; photoUrl: string; cookedAt: string } };
      expect(result.spoon.nextTime).toBe("salt more");
      expect(result.spoon.photoUrl).toBe("https://stub.test/new.png");
      expect(result.spoon.cookedAt).toBe("2025-06-02T00:00:00.000Z");
    });

    it("refreshes the active origin-cook cover when an uploaded spoon photo changes", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const existing = await db.recipeSpoon.create({
        data: {
          chefId: chef.id,
          recipeId: recipe.id,
          photoUrl: "https://stub.test/old.png",
        },
      });
      await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: existing.photoUrl!,
          sourceType: "spoon",
          sourceSpoonId: existing.id,
        },
      });
      const bucket = mockR2();
      const uploaded = await callSpoonjoyApiOperation("upload_spoon_photo", {
        imageBase64: Buffer.from(VALID_PNG_BYTES).toString("base64"),
        mimeType: "image/png",
        filename: "new.png",
      }, { db, principal: chef, bucket }) as { imageUrl: string };
      const captured: Promise<unknown>[] = [];
      const runner = {
        textToImage: vi.fn(),
        imageToImage: vi.fn().mockResolvedValue({ bytes: GENERATED_BYTES, contentType: "image/png" }),
      };

      const result = (await callSpoonjoyApiOperation(
        "update_spoon",
        { spoonId: existing.id, photoUrl: uploaded.imageUrl },
        {
          db,
          principal: chef,
          bucket,
          imageGenRunner: runner,
          waitUntil: (p) => captured.push(p),
        },
      )) as { spoon: { photoUrl: string }; cover: { id: string; imageUrl: string } };

      expect(result.spoon.photoUrl).toBe(uploaded.imageUrl);
      expect(result.cover.imageUrl).toBe(uploaded.imageUrl);
      const activeCover = await db.recipeCover.findUniqueOrThrow({ where: { id: result.cover.id } });
      expect(activeCover).toMatchObject({
        recipeId: recipe.id,
        sourceType: "spoon",
        sourceSpoonId: existing.id,
        imageUrl: uploaded.imageUrl,
        stylizedImageUrl: null,
      });
      expect(captured).toHaveLength(1);
      await captured[0];
      expect(runner.imageToImage).toHaveBeenCalledTimes(1);
    });

    it("refreshes an origin cover from an external spoon photo without stylization", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const existing = await db.recipeSpoon.create({
        data: {
          chefId: chef.id,
          recipeId: recipe.id,
          photoUrl: "https://stub.test/old.png",
        },
      });
      await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: existing.photoUrl!,
          sourceType: "spoon",
          sourceSpoonId: existing.id,
        },
      });
      const captured: Promise<unknown>[] = [];
      const runner = {
        textToImage: vi.fn(),
        imageToImage: vi.fn().mockResolvedValue({ bytes: GENERATED_BYTES, contentType: "image/png" }),
      };

      const result = (await callSpoonjoyApiOperation(
        "update_spoon",
        { spoonId: existing.id, photoUrl: "https://stub.test/new-external.png" },
        {
          db,
          principal: chef,
          imageGenRunner: runner,
          waitUntil: (p) => captured.push(p),
        },
      )) as { spoon: { photoUrl: string }; cover: { imageUrl: string } };

      expect(result.spoon.photoUrl).toBe("https://stub.test/new-external.png");
      expect(result.cover.imageUrl).toBe("https://stub.test/new-external.png");
      expect(captured).toHaveLength(0);
      expect(runner.imageToImage).not.toHaveBeenCalled();
    });

    it("does not let a non-origin owner spoon replace the recipe cover on photo update", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const origin = await db.recipeSpoon.create({
        data: {
          chefId: chef.id,
          recipeId: recipe.id,
          photoUrl: "https://stub.test/origin.png",
        },
      });
      await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: origin.photoUrl!,
          sourceType: "spoon",
          sourceSpoonId: origin.id,
        },
      });
      const later = await db.recipeSpoon.create({
        data: {
          chefId: chef.id,
          recipeId: recipe.id,
          note: "second cook",
        },
      });
      const bucket = mockR2();
      const uploaded = await callSpoonjoyApiOperation("upload_spoon_photo", {
        imageBase64: Buffer.from(VALID_PNG_BYTES).toString("base64"),
        mimeType: "image/png",
        filename: "later.png",
      }, { db, principal: chef, bucket }) as { imageUrl: string };
      const captured: Promise<unknown>[] = [];
      const runner = {
        textToImage: vi.fn(),
        imageToImage: vi.fn().mockResolvedValue({ bytes: GENERATED_BYTES, contentType: "image/png" }),
      };

      const result = (await callSpoonjoyApiOperation(
        "update_spoon",
        { spoonId: later.id, photoUrl: uploaded.imageUrl },
        {
          db,
          principal: chef,
          bucket,
          imageGenRunner: runner,
          waitUntil: (p) => captured.push(p),
        },
      )) as { spoon: { photoUrl: string }; cover: null };

      expect(result.spoon.photoUrl).toBe(uploaded.imageUrl);
      expect(result.cover).toBeNull();
      await expect(db.recipeCover.count({ where: { sourceSpoonId: later.id } })).resolves.toBe(0);
      expect(captured).toHaveLength(0);
      expect(runner.imageToImage).not.toHaveBeenCalled();
    });

    it("rejects updates that empty all content fields (note=null nulls the note)", async () => {
      const { principal: cook } = await makeUser(db);
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const created = await db.recipeSpoon.create({
        data: { chefId: cook.id, recipeId: recipe.id, note: "first" },
      });
      const context: SpoonjoyApiContext = { db, principal: cook };
      await expect(
        callSpoonjoyApiOperation(
          "update_spoon",
          { spoonId: created.id, note: null, nextTime: null, photoUrl: null },
          context,
        ),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("rejects invalid cookedAt patches (malformed string)", async () => {
      const { principal: cook } = await makeUser(db);
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const created = await db.recipeSpoon.create({
        data: { chefId: cook.id, recipeId: recipe.id, note: "first" },
      });
      const context: SpoonjoyApiContext = { db, principal: cook };
      await expect(
        callSpoonjoyApiOperation(
          "update_spoon",
          { spoonId: created.id, cookedAt: "nope" },
          context,
        ),
      ).rejects.toThrow(/cookedAt/);
    });

    it("rejects empty cookedAt patches (no usable date)", async () => {
      const { principal: cook } = await makeUser(db);
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const created = await db.recipeSpoon.create({
        data: { chefId: cook.id, recipeId: recipe.id, note: "first" },
      });
      const context: SpoonjoyApiContext = { db, principal: cook };
      await expect(
        callSpoonjoyApiOperation(
          "update_spoon",
          { spoonId: created.id, cookedAt: "" },
          context,
        ),
      ).rejects.toThrow(/cookedAt/);
    });

    it("requires spoonId", async () => {
      const { principal: cook } = await makeUser(db);
      const context: SpoonjoyApiContext = { db, principal: cook };
      await expect(
        callSpoonjoyApiOperation("update_spoon", { note: "x" }, context),
      ).rejects.toMatchObject({ message: expect.stringMatching(/spoonId/i) });
    });
  });

  describe("list_spoons_for_recipe", () => {
    it("returns spoons with chef relation and derived coverImageUrl per row", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: cook } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      await db.recipeSpoon.create({
        data: { chefId: cook.id, recipeId: recipe.id, note: "hi" },
      });
      const context: SpoonjoyApiContext = { db, principal: cook };
      const result = (await callSpoonjoyApiOperation(
        "list_spoons_for_recipe",
        { recipeId: recipe.id },
        context,
      )) as { spoons: Array<{ chef: { username: string }; coverImageUrl: string | null }> };
      expect(result.spoons).toHaveLength(1);
      expect(result.spoons[0].chef.username).toBe(cook.username);
      expect(result.spoons[0].coverImageUrl).toBeNull();
    });

    it("respects limit/offset", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: cook1 } = await makeUser(db);
      const { principal: cook2 } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      await db.recipeSpoon.create({
        data: {
          chefId: cook1.id,
          recipeId: recipe.id,
          note: "first",
          cookedAt: new Date("2025-01-01T00:00:00Z"),
        },
      });
      await db.recipeSpoon.create({
        data: {
          chefId: cook2.id,
          recipeId: recipe.id,
          note: "second",
          cookedAt: new Date("2025-02-01T00:00:00Z"),
        },
      });
      const context: SpoonjoyApiContext = { db, principal: cook1 };
      const limited = (await callSpoonjoyApiOperation(
        "list_spoons_for_recipe",
        { recipeId: recipe.id, limit: 1 },
        context,
      )) as { spoons: Array<{ note: string }> };
      expect(limited.spoons).toHaveLength(1);
      expect(limited.spoons[0].note).toBe("second");

      const offset = (await callSpoonjoyApiOperation(
        "list_spoons_for_recipe",
        { recipeId: recipe.id, limit: 1, offset: 1 },
        context,
      )) as { spoons: Array<{ note: string }> };
      expect(offset.spoons[0].note).toBe("first");
    });

    it("rejects ownerEmail", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const context: SpoonjoyApiContext = { db, principal: chef };
      await expect(
        callSpoonjoyApiOperation(
          "list_spoons_for_recipe",
          { recipeId: recipe.id, ownerEmail: "x" },
          context,
        ),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("requires recipeId", async () => {
      const { principal: chef } = await makeUser(db);
      const context: SpoonjoyApiContext = { db, principal: chef };
      await expect(
        callSpoonjoyApiOperation("list_spoons_for_recipe", {}, context),
      ).rejects.toMatchObject({ message: expect.stringMatching(/recipeId/i) });
    });

    it("excludes soft-deleted spoons", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: cook } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      await db.recipeSpoon.create({
        data: {
          chefId: cook.id,
          recipeId: recipe.id,
          note: "first",
          deletedAt: new Date(),
        },
      });
      const context: SpoonjoyApiContext = { db, principal: cook };
      const result = (await callSpoonjoyApiOperation(
        "list_spoons_for_recipe",
        { recipeId: recipe.id },
        context,
      )) as { spoons: unknown[] };
      expect(result.spoons).toHaveLength(0);
    });

    it("requires authentication", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const context: SpoonjoyApiContext = { db, principal: null };
      await expect(
        callSpoonjoyApiOperation(
          "list_spoons_for_recipe",
          { recipeId: recipe.id },
          context,
        ),
      ).rejects.toMatchObject({ status: 401 });
    });

    it("returns coverImageUrl=null when the recipe row is missing", async () => {
      const { principal: chef } = await makeUser(db);
      const context: SpoonjoyApiContext = { db, principal: chef };
      const result = (await callSpoonjoyApiOperation(
        "list_spoons_for_recipe",
        { recipeId: "missing-recipe-id" },
        context,
      )) as { spoons: unknown[] };
      expect(result.spoons).toHaveLength(0);
    });
  });

  describe("list_spoons_by_chef", () => {
    it("returns spoons by chef id with recipe + coverImageUrl preloaded", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      await db.recipeSpoon.create({
        data: {
          chefId: chef.id,
          recipeId: recipe.id,
          photoUrl: "/photos/x.png",
          cookedAt: new Date("2025-01-01T00:00:00Z"),
        },
      });
      const context: SpoonjoyApiContext = { db, principal: chef };
      const result = (await callSpoonjoyApiOperation(
        "list_spoons_by_chef",
        { chefIdOrUsername: chef.id },
        context,
      )) as { spoons: Array<{ recipe: { id: string; title: string }; coverImageUrl: string | null }> };
      expect(result.spoons).toHaveLength(1);
      expect(result.spoons[0].recipe.id).toBe(recipe.id);
      expect(result.spoons[0].recipe.title).toBe(recipe.title);
      expect(result.spoons[0].coverImageUrl).toBeNull();
    });

    it("resolves by username", async () => {
      const { user, principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      await db.recipeSpoon.create({
        data: { chefId: chef.id, recipeId: recipe.id, photoUrl: "/x" },
      });
      const context: SpoonjoyApiContext = { db, principal: chef };
      const result = (await callSpoonjoyApiOperation(
        "list_spoons_by_chef",
        { chefIdOrUsername: user.username },
        context,
      )) as { spoons: unknown[] };
      expect(result.spoons).toHaveLength(1);
    });

    it("returns 404 when chef is not found", async () => {
      const { principal: chef } = await makeUser(db);
      const context: SpoonjoyApiContext = { db, principal: chef };
      await expect(
        callSpoonjoyApiOperation(
          "list_spoons_by_chef",
          { chefIdOrUsername: "missing-user-zzz" },
          context,
        ),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("rejects ownerEmail", async () => {
      const { principal: chef } = await makeUser(db);
      const context: SpoonjoyApiContext = { db, principal: chef };
      await expect(
        callSpoonjoyApiOperation(
          "list_spoons_by_chef",
          { chefIdOrUsername: chef.id, ownerEmail: "x" },
          context,
        ),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("requires chefIdOrUsername", async () => {
      const { principal: chef } = await makeUser(db);
      const context: SpoonjoyApiContext = { db, principal: chef };
      await expect(
        callSpoonjoyApiOperation("list_spoons_by_chef", {}, context),
      ).rejects.toMatchObject({ message: expect.stringMatching(/chefIdOrUsername/i) });
    });

    it("excludes soft-deleted by default", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      await db.recipeSpoon.create({
        data: {
          chefId: chef.id,
          recipeId: recipe.id,
          photoUrl: "/x",
          deletedAt: new Date(),
        },
      });
      const context: SpoonjoyApiContext = { db, principal: chef };
      const result = (await callSpoonjoyApiOperation(
        "list_spoons_by_chef",
        { chefIdOrUsername: chef.id },
        context,
      )) as { spoons: unknown[] };
      expect(result.spoons).toHaveLength(0);
    });

    it("requires authentication", async () => {
      const context: SpoonjoyApiContext = { db, principal: null };
      await expect(
        callSpoonjoyApiOperation(
          "list_spoons_by_chef",
          { chefIdOrUsername: "x" },
          context,
        ),
      ).rejects.toMatchObject({ status: 401 });
    });

    it("respects limit/offset", async () => {
      const { principal: chef } = await makeUser(db);
      const r1 = await makeRecipe(db, chef.id);
      const r2 = await makeRecipe(db, chef.id);
      await db.recipeSpoon.create({
        data: {
          chefId: chef.id,
          recipeId: r1.id,
          photoUrl: "/p1",
          cookedAt: new Date("2025-01-01T00:00:00Z"),
        },
      });
      await db.recipeSpoon.create({
        data: {
          chefId: chef.id,
          recipeId: r2.id,
          photoUrl: "/p2",
          cookedAt: new Date("2025-02-01T00:00:00Z"),
        },
      });
      const context: SpoonjoyApiContext = { db, principal: chef };
      const limited = (await callSpoonjoyApiOperation(
        "list_spoons_by_chef",
        { chefIdOrUsername: chef.id, limit: 1 },
        context,
      )) as { spoons: Array<{ recipe: { id: string } }> };
      expect(limited.spoons).toHaveLength(1);
      expect(limited.spoons[0].recipe.id).toBe(r2.id);
      const offset = (await callSpoonjoyApiOperation(
        "list_spoons_by_chef",
        { chefIdOrUsername: chef.id, limit: 1, offset: 1 },
        context,
      )) as { spoons: Array<{ recipe: { id: string } }> };
      expect(offset.spoons[0].recipe.id).toBe(r1.id);
    });
  });

  describe("delete_spoon", () => {
    it("soft-deletes the owning principal's spoon", async () => {
      const { principal: cook } = await makeUser(db);
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const created = await db.recipeSpoon.create({
        data: { chefId: cook.id, recipeId: recipe.id, note: "first" },
      });
      const context: SpoonjoyApiContext = { db, principal: cook };
      const result = (await callSpoonjoyApiOperation(
        "delete_spoon",
        { spoonId: created.id },
        context,
      )) as { spoon: { id: string; deletedAt: string | null } };
      expect(result.spoon.id).toBe(created.id);
      expect(result.spoon.deletedAt).not.toBeNull();
    });

    it("rejects delete from a non-owner with 403", async () => {
      const { principal: cook } = await makeUser(db);
      const { principal: stranger } = await makeUser(db);
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const created = await db.recipeSpoon.create({
        data: { chefId: cook.id, recipeId: recipe.id, note: "first" },
      });
      const context: SpoonjoyApiContext = { db, principal: stranger };
      await expect(
        callSpoonjoyApiOperation(
          "delete_spoon",
          { spoonId: created.id },
          context,
        ),
      ).rejects.toMatchObject({ status: 403 });
    });

    it("rejects when ownerEmail is supplied", async () => {
      const { principal: cook } = await makeUser(db);
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const created = await db.recipeSpoon.create({
        data: { chefId: cook.id, recipeId: recipe.id, note: "first" },
      });
      const context: SpoonjoyApiContext = { db, principal: cook };
      await expect(
        callSpoonjoyApiOperation(
          "delete_spoon",
          { spoonId: created.id, ownerEmail: "x" },
          context,
        ),
      ).rejects.toMatchObject({ status: 400 });
    });
  });
});
