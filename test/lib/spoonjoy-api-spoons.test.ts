import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { getLocalDb } from "~/lib/db.server";
import {
  __internal__,
  callSpoonjoyApiOperation,
  listSpoonjoyApiOperations,
  type SpoonjoyApiContext,
} from "~/lib/spoonjoy-api.server";
import {
  hashIdempotencyRequest,
  idempotencyClientKey,
} from "~/lib/api-idempotency.server";
import { ApiAuthError, type ApiPrincipal } from "~/lib/api-auth.server";
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

function dataUrl(bytes = VALID_PNG_BYTES) {
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

function imageRunner() {
  return {
    textToImage: vi.fn(),
    imageToImage: vi.fn().mockResolvedValue({ bytes: GENERATED_BYTES, contentType: "image/png" }),
  };
}

async function mcpCoverMutationHash(
  operation: string,
  recipeId: string,
  body: Record<string, unknown>,
) {
  const normalizedBody = Object.fromEntries(
    Object.entries(body).filter(([key]) => key !== "dryRun" && key !== "idempotencyKey"),
  );
  return hashIdempotencyRequest({
    method: "MCP",
    path: `/mcp/tools/${operation}/recipes/${recipeId}`,
    body: normalizedBody,
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
          "list_recipe_covers",
          "list_recipe_spoon_images",
          "create_recipe_cover_from_upload",
          "create_recipe_cover_from_spoon",
          "regenerate_recipe_cover",
          "get_cover_generation_status",
          "set_active_recipe_cover",
          "archive_recipe_cover",
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

  describe("recipe cover read operations", () => {
    it("exposes active cover provenance and status on existing get_recipe responses", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const cover = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "/photos/raw.jpg",
          stylizedImageUrl: null,
          sourceType: "spoon",
          status: "processing",
          generationStatus: "processing",
        },
      });
      await db.recipe.update({
        where: { id: recipe.id },
        data: {
          activeCoverId: cover.id,
          activeCoverVariant: "image",
          coverMode: "manual",
        },
      });

      const result = (await callSpoonjoyApiOperation(
        "get_recipe",
        { id: recipe.id },
        { db, principal: chef },
      )) as {
        recipe: {
          imageUrl: string | null;
          coverImageUrl: string | null;
          coverProvenanceLabel: string | null;
          coverSourceType: string | null;
          coverVariant: string | null;
          coverStatus: string | null;
          coverGenerationStatus: string | null;
          activeCover: Record<string, unknown> | null;
        };
      };

      expect(result.recipe).toMatchObject({
        imageUrl: "/photos/raw.jpg",
        coverImageUrl: "/photos/raw.jpg",
        coverProvenanceLabel: "Chef photo",
        coverSourceType: "spoon",
        coverVariant: "image",
        coverStatus: "processing",
        coverGenerationStatus: "processing",
        activeCover: {
          id: cover.id,
          recipeId: recipe.id,
          displayUrl: "/photos/raw.jpg",
          sourceType: "spoon",
          activeVariant: "image",
          provenanceLabel: "Chef photo",
          status: "processing",
          generationStatus: "processing",
        },
      });
      expect(result.recipe.activeCover).not.toHaveProperty("failureReason");
      expect(result.recipe.activeCover).not.toHaveProperty("sourceImageUrl");
    });

    it("exposes active cover status on recipe summary responses", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const cover = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "/photos/ready.jpg",
          sourceType: "chef-upload",
          status: "ready",
          generationStatus: "succeeded",
        },
      });
      await db.recipe.update({
        where: { id: recipe.id },
        data: { activeCoverId: cover.id, activeCoverVariant: "image", coverMode: "manual" },
      });
      const result = (await callSpoonjoyApiOperation(
        "search_recipes",
        { query: recipe.title },
        { db, principal: chef },
      )) as {
        recipes: Array<{
          id: string;
          coverStatus: string | null;
          coverGenerationStatus: string | null;
          activeCover: Record<string, unknown> | null;
        }>;
      };

      expect(result.recipes).toEqual([
        expect.objectContaining({
          id: recipe.id,
          coverStatus: "ready",
          coverGenerationStatus: "succeeded",
          activeCover: expect.objectContaining({
            id: cover.id,
            status: "ready",
            generationStatus: "succeeded",
          }),
        }),
      ]);
    });

    it("returns owner/full cover history with archived and failed metadata", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const spoon = await db.recipeSpoon.create({
        data: {
          recipeId: recipe.id,
          chefId: chef.id,
          photoUrl: "/photos/spoons/risotto.jpg",
        },
      });
      const active = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "/photos/raw.jpg",
          stylizedImageUrl: "/photos/editorial.jpg",
          sourceType: "spoon",
          sourceSpoonId: spoon.id,
          status: "ready",
          generationStatus: "succeeded",
          createdById: chef.id,
          sourceImageUrl: "/photos/spoons/risotto.jpg",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      });
      const failed = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "/photos/failed-raw.jpg",
          sourceType: "chef-upload",
          status: "ready",
          generationStatus: "failed",
          failureReason: "quota_exhausted",
          createdById: chef.id,
          sourceImageUrl: "/photos/source.jpg",
          createdAt: new Date("2026-01-02T00:00:00.000Z"),
        },
      });
      const archived = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "/photos/archived.jpg",
          sourceType: "import",
          status: "archived",
          archivedAt: new Date("2026-01-03T00:00:00.000Z"),
          createdAt: new Date("2026-01-03T00:00:00.000Z"),
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

      const page = (await callSpoonjoyApiOperation(
        "list_recipe_covers",
        { recipeId: recipe.id, includeArchived: true, limit: 2 },
        { db, principal: chef },
      )) as {
        covers: Array<Record<string, unknown>>;
        activeCover: Record<string, unknown>;
        pagination: { limit: number; offset: number; count: number; hasMore: boolean };
      };

      expect(page.pagination).toEqual({ limit: 2, offset: 0, count: 2, hasMore: true });
      expect(page.activeCover).toMatchObject({
        id: active.id,
        recipeId: recipe.id,
        displayUrl: "/photos/editorial.jpg",
        activeVariant: "stylized",
        provenanceLabel: "Editorialized chef photo",
        sourceSpoonId: spoon.id,
        createdById: chef.id,
        generationStatus: "succeeded",
      });
      expect(page.covers.map((cover) => cover.id)).toEqual([archived.id, failed.id]);
      expect(page.covers[0]).toMatchObject({
        id: archived.id,
        status: "archived",
        archivedAt: "2026-01-03T00:00:00.000Z",
        provenanceLabel: "Imported photo",
      });
      expect(page.covers[1]).toMatchObject({
        id: failed.id,
        status: "ready",
        generationStatus: "failed",
        failureReason: "quota_exhausted",
        sourceImageUrl: "/photos/source.jpg",
      });
    });

    it("limits non-owner cover history reads to active public cover metadata", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: cook } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const active = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "/photos/raw.jpg",
          sourceType: "chef-upload",
          status: "ready",
          generationStatus: "failed",
          failureReason: "visible-only-to-owner",
          sourceImageUrl: "/photos/private-source.jpg",
        },
      });
      await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "/photos/archived.jpg",
          sourceType: "import",
          status: "archived",
          archivedAt: new Date(),
        },
      });
      await db.recipe.update({
        where: { id: recipe.id },
        data: { activeCoverId: active.id, activeCoverVariant: "image", coverMode: "manual" },
      });

      const page = (await callSpoonjoyApiOperation(
        "list_recipe_covers",
        { recipeId: recipe.id, includeArchived: true },
        { db, principal: { ...cook, scopes: ["recipes:read"] } },
      )) as { covers: Array<Record<string, unknown>>; activeCover: Record<string, unknown> | null };

      expect(page.covers).toHaveLength(1);
      expect(page.activeCover).toMatchObject({
        id: active.id,
        displayUrl: "/photos/raw.jpg",
        sourceType: "chef-upload",
        activeVariant: "image",
        provenanceLabel: "Chef photo",
        status: "ready",
        generationStatus: "failed",
      });
      expect(page.covers[0]).not.toHaveProperty("failureReason");
      expect(page.covers[0]).not.toHaveProperty("sourceImageUrl");
      expect(page.covers[0]).not.toHaveProperty("createdById");

      const emptyPage = (await callSpoonjoyApiOperation(
        "list_recipe_covers",
        { recipeId: recipe.id, offset: 1 },
        { db, principal: { ...cook, scopes: ["recipes:read"] } },
      )) as {
        covers: Array<Record<string, unknown>>;
        activeCover: Record<string, unknown> | null;
        pagination: { limit: number; offset: number; count: number; hasMore: boolean };
      };

      expect(emptyPage).toEqual({
        covers: [],
        activeCover: page.activeCover,
        pagination: { limit: 25, offset: 1, count: 0, hasMore: false },
      });
    });

    it("lists owner-only spoon images for recipe cover source selection", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: cook } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const older = await db.recipeSpoon.create({
        data: {
          recipeId: recipe.id,
          chefId: cook.id,
          photoUrl: "/photos/spoons/older.jpg",
          cookedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      });
      const newer = await db.recipeSpoon.create({
        data: {
          recipeId: recipe.id,
          chefId: chef.id,
          photoUrl: "/photos/spoons/newer.jpg",
          cookedAt: new Date("2026-01-02T00:00:00.000Z"),
        },
      });
      await db.recipeSpoon.create({
        data: { recipeId: recipe.id, chefId: chef.id, note: "no photo" },
      });
      await db.recipeSpoon.create({
        data: {
          recipeId: recipe.id,
          chefId: chef.id,
          photoUrl: "/photos/spoons/deleted.jpg",
          deletedAt: new Date(),
        },
      });

      const firstPage = (await callSpoonjoyApiOperation(
        "list_recipe_spoon_images",
        { recipeId: recipe.id, limit: 1 },
        { db, principal: chef },
      )) as {
        spoonImages: Array<{ id: string; photoUrl: string; chef: { id: string; username: string } }>;
        pagination: { limit: number; offset: number; count: number; hasMore: boolean };
      };

      expect(firstPage.pagination).toEqual({ limit: 1, offset: 0, count: 1, hasMore: true });
      expect(firstPage.spoonImages).toEqual([
        expect.objectContaining({
          id: newer.id,
          photoUrl: "/photos/spoons/newer.jpg",
          chef: expect.objectContaining({ id: chef.id, username: chef.username }),
        }),
      ]);

      const secondPage = (await callSpoonjoyApiOperation(
        "list_recipe_spoon_images",
        { recipeId: recipe.id, limit: 1, offset: 1 },
        { db, principal: chef },
      )) as { spoonImages: Array<{ id: string }> };
      expect(secondPage.spoonImages).toEqual([expect.objectContaining({ id: older.id })]);
    });

    it("rejects non-owner and read-only callers for recipe spoon image browsing", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: cook } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);

      await expect(callSpoonjoyApiOperation(
        "list_recipe_spoon_images",
        { recipeId: recipe.id },
        { db, principal: cook },
      )).rejects.toMatchObject({ status: 403 });

      await expect(callSpoonjoyApiOperation(
        "list_recipe_spoon_images",
        { recipeId: recipe.id },
        { db, principal: { ...chef, scopes: ["recipes:read"] } },
      )).rejects.toMatchObject({ status: 403, message: "Missing required scope: kitchen:write" });
    });

    it("returns empty public cover metadata when the active cover is not displayable", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: cook } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);

      const noActivePage = (await callSpoonjoyApiOperation(
        "list_recipe_covers",
        { recipeId: recipe.id },
        { db, principal: { ...cook, scopes: ["recipes:read"] } },
      )) as { covers: unknown[]; activeCover: unknown; pagination: { limit: number; offset: number; count: number; hasMore: boolean } };

      expect(noActivePage).toEqual({
        covers: [],
        activeCover: null,
        pagination: { limit: 25, offset: 0, count: 0, hasMore: false },
      });

      const emptyCover = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "",
          sourceType: "chef-upload",
          status: "ready",
        },
      });
      await db.recipe.update({
        where: { id: recipe.id },
        data: { activeCoverId: emptyCover.id, activeCoverVariant: "image", coverMode: "manual" },
      });

      const page = (await callSpoonjoyApiOperation(
        "list_recipe_covers",
        { recipeId: recipe.id },
        { db, principal: { ...cook, scopes: ["recipes:read"] } },
      )) as { covers: unknown[]; activeCover: unknown; pagination: { limit: number; offset: number; count: number; hasMore: boolean } };

      expect(page).toEqual({
        covers: [],
        activeCover: null,
        pagination: { limit: 25, offset: 0, count: 0, hasMore: false },
      });
    });

    it("returns owner cover history without an active cover and excludes archived rows by default", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const ready = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "/photos/current.jpg",
          sourceType: "chef-upload",
          status: "ready",
          createdAt: new Date("2026-01-02T00:00:00.000Z"),
        },
      });
      const empty = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "",
          sourceType: "chef-upload",
          status: "ready",
          createdAt: new Date("2026-01-04T00:00:00.000Z"),
        },
      });
      await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "/photos/archived.jpg",
          sourceType: "import",
          status: "archived",
          archivedAt: new Date("2026-01-03T00:00:00.000Z"),
          createdAt: new Date("2026-01-03T00:00:00.000Z"),
        },
      });

      const page = (await callSpoonjoyApiOperation(
        "list_recipe_covers",
        { recipeId: recipe.id, limit: 99, offset: -5 },
        { db, principal: chef },
      )) as {
        covers: Array<{
          id: string;
          displayUrl: string | null;
          activeVariant: string | null;
          provenanceLabel: string | null;
        }>;
        activeCover: unknown;
        pagination: { limit: number; offset: number; count: number; hasMore: boolean };
      };

      expect(page.pagination).toEqual({ limit: 25, offset: 0, count: 2, hasMore: false });
      expect(page.activeCover).toBeNull();
      expect(page.covers).toEqual([
        expect.objectContaining({
          id: empty.id,
          displayUrl: null,
          activeVariant: null,
          provenanceLabel: null,
        }),
        expect.objectContaining({
          id: ready.id,
          displayUrl: "/photos/current.jpg",
          activeVariant: null,
        }),
      ]);
    });

    it("returns 404 for missing recipe cover and spoon image browse targets", async () => {
      const { principal: chef } = await makeUser(db);

      await expect(callSpoonjoyApiOperation(
        "list_recipe_covers",
        { recipeId: "missing-recipe" },
        { db, principal: chef },
      )).rejects.toMatchObject({ status: 404, message: "Recipe not found" });

      await expect(callSpoonjoyApiOperation(
        "list_recipe_spoon_images",
        { recipeId: "missing-recipe" },
        { db, principal: chef },
      )).rejects.toMatchObject({ status: 404, message: "Recipe not found" });
    });

    it("filters blank spoon photo URLs from cover source browsing", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      await db.recipeSpoon.create({
        data: {
          recipeId: recipe.id,
          chefId: chef.id,
          photoUrl: "",
          cookedAt: new Date("2026-01-02T00:00:00.000Z"),
        },
      });
      const valid = await db.recipeSpoon.create({
        data: {
          recipeId: recipe.id,
          chefId: chef.id,
          photoUrl: "/photos/spoons/usable.jpg",
          cookedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      });

      const page = (await callSpoonjoyApiOperation(
        "list_recipe_spoon_images",
        { recipeId: recipe.id, limit: 1 },
        { db, principal: chef },
      )) as {
        spoonImages: Array<{ id: string; photoUrl: string }>;
        pagination: { limit: number; offset: number; count: number; hasMore: boolean };
      };

      expect(page).toEqual({
        spoonImages: [
          expect.objectContaining({
            id: valid.id,
            photoUrl: "/photos/spoons/usable.jpg",
          }),
        ],
        pagination: { limit: 1, offset: 0, count: 1, hasMore: false },
      });
    });
  });

  describe("recipe cover write operations", () => {
    it("dry-runs upload cover creation without writing or consuming idempotency", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const currentCover = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "/photos/current.jpg",
          sourceType: "chef-upload",
          status: "ready",
        },
      });
      await db.recipe.update({
        where: { id: recipe.id },
        data: { activeCoverId: currentCover.id, activeCoverVariant: "image", coverMode: "manual" },
      });

      const result = await callSpoonjoyApiOperation(
        "create_recipe_cover_from_upload",
        {
          recipeId: recipe.id,
          imageUrl: dataUrl(),
          activate: true,
          generateEditorial: true,
          idempotencyKey: "dry-run-cover-upload",
          dryRun: true,
        },
        { db, principal: chef, allowLocalImageFallback: true },
      ) as {
        activeCover: { id: string } | null;
        previousActiveCover: { id: string } | null;
        createdCover: unknown;
        generationStatus: string;
        warnings: string[];
        nextActions: string[];
      };

      expect(result).toMatchObject({
        activeCover: { id: currentCover.id },
        previousActiveCover: { id: currentCover.id },
        createdCover: null,
        generationStatus: "dry_run",
        warnings: [],
      });
      expect(result.nextActions).toContain("create_recipe_cover_from_upload");
      await expect(db.recipeCover.count({ where: { recipeId: recipe.id } })).resolves.toBe(1);
      await expect(db.apiIdempotencyKey.count({ where: { key: "dry-run-cover-upload" } })).resolves.toBe(0);
    });

    it("creates upload cover candidates without replacing manual active covers unless activated", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const currentCover = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "/photos/current.jpg",
          sourceType: "chef-upload",
          status: "ready",
        },
      });
      await db.recipe.update({
        where: { id: recipe.id },
        data: { activeCoverId: currentCover.id, activeCoverVariant: "image", coverMode: "manual" },
      });

      const candidate = await callSpoonjoyApiOperation(
        "create_recipe_cover_from_upload",
        {
          recipeId: recipe.id,
          imageUrl: dataUrl(),
          generateEditorial: false,
        },
        { db, principal: chef, allowLocalImageFallback: true },
      ) as {
        activeCover: { id: string } | null;
        previousActiveCover: { id: string } | null;
        createdCover: { id: string; imageUrl: string; sourceType: string; status: string; generationStatus: string };
        generationStatus: string;
        warnings: string[];
        nextActions: string[];
      };

      expect(candidate).toMatchObject({
        activeCover: { id: currentCover.id },
        previousActiveCover: { id: currentCover.id },
        createdCover: {
          imageUrl: dataUrl(),
          sourceType: "chef-upload",
          status: "ready",
          generationStatus: "none",
        },
        generationStatus: "none",
      });
      expect(candidate.nextActions).toContain("set_active_recipe_cover");
      await expect(db.recipe.findUniqueOrThrow({
        where: { id: recipe.id },
        select: { activeCoverId: true, activeCoverVariant: true, coverMode: true },
      })).resolves.toEqual({
        activeCoverId: currentCover.id,
        activeCoverVariant: "image",
        coverMode: "manual",
      });
    });

    it("creates and activates spoon cover candidates for owner spoons only", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: cook } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const spoon = await db.recipeSpoon.create({
        data: {
          recipeId: recipe.id,
          chefId: chef.id,
          photoUrl: "/photos/spoons/source.jpg",
        },
      });

      const result = await callSpoonjoyApiOperation(
        "create_recipe_cover_from_spoon",
        {
          recipeId: recipe.id,
          spoonId: spoon.id,
          activate: true,
          generateEditorial: false,
        },
        { db, principal: chef },
      ) as {
        activeCover: { id: string; sourceSpoonId: string | null; sourceType: string; activeVariant: string | null } | null;
        previousActiveCover: null;
        createdCover: { id: string; sourceSpoonId: string | null; sourceType: string; imageUrl: string };
      };

      expect(result.previousActiveCover).toBeNull();
      expect(result.createdCover).toMatchObject({
        sourceType: "spoon",
        sourceSpoonId: spoon.id,
        imageUrl: "/photos/spoons/source.jpg",
      });
      expect(result.activeCover).toMatchObject({
        id: result.createdCover.id,
        sourceSpoonId: spoon.id,
        sourceType: "spoon",
        activeVariant: "image",
      });
      await expect(callSpoonjoyApiOperation(
        "create_recipe_cover_from_spoon",
        { recipeId: recipe.id, spoonId: spoon.id },
        { db, principal: cook },
      )).rejects.toMatchObject({ status: 403 });
    });

    it("regenerates a cover and exposes generation status", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const cover = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: dataUrl(),
          sourceType: "chef-upload",
          sourceImageUrl: dataUrl(),
          status: "ready",
        },
      });
      await db.recipe.update({
        where: { id: recipe.id },
        data: { activeCoverId: cover.id, activeCoverVariant: "image", coverMode: "manual" },
      });
      const runner = imageRunner();

      const regenerated = await callSpoonjoyApiOperation(
        "regenerate_recipe_cover",
        {
          recipeId: recipe.id,
          coverId: cover.id,
          activateWhenReady: true,
        },
        { db, principal: chef, allowLocalImageFallback: true, imageGenRunner: runner },
      ) as {
        activeCover: { id: string; activeVariant: string; generationStatus: string } | null;
        createdCover: { id: string; stylizedImageUrl: string | null; generationStatus: string; status: string };
        generationStatus: string;
      };

      expect(runner.imageToImage).toHaveBeenCalledTimes(1);
      expect(regenerated.createdCover).toMatchObject({
        id: cover.id,
        status: "ready",
        generationStatus: "succeeded",
      });
      expect(regenerated.createdCover.stylizedImageUrl).toBe(`data:image/png;base64,${Buffer.from(GENERATED_BYTES).toString("base64")}`);
      expect(regenerated.activeCover).toMatchObject({
        id: cover.id,
        activeVariant: "stylized",
        generationStatus: "succeeded",
      });
      expect(regenerated.generationStatus).toBe("succeeded");

      const status = await callSpoonjoyApiOperation(
        "get_cover_generation_status",
        { recipeId: recipe.id, coverId: cover.id },
        { db, principal: chef },
      ) as { cover: { id: string; generationStatus: string; status: string; stylizedImageUrl: string | null }; activeCover: { id: string } | null };
      expect(status.cover).toMatchObject({
        id: cover.id,
        status: "ready",
        generationStatus: "succeeded",
      });
      expect(status.activeCover).toMatchObject({ id: cover.id });
    });

    it("replays exact idempotent upload cover mutations and rejects key conflicts", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const first = await callSpoonjoyApiOperation(
        "create_recipe_cover_from_upload",
        {
          recipeId: recipe.id,
          imageUrl: dataUrl(),
          generateEditorial: false,
          idempotencyKey: "upload-cover-idempotent",
        },
        { db, principal: chef, allowLocalImageFallback: true },
      ) as { createdCover: { id: string }; mutation: { replayed: boolean } };
      const replay = await callSpoonjoyApiOperation(
        "create_recipe_cover_from_upload",
        {
          recipeId: recipe.id,
          imageUrl: dataUrl(),
          generateEditorial: false,
          idempotencyKey: "upload-cover-idempotent",
        },
        { db, principal: chef, allowLocalImageFallback: true },
      ) as { createdCover: { id: string }; mutation: { replayed: boolean } };

      expect(replay.createdCover.id).toBe(first.createdCover.id);
      expect(replay.mutation.replayed).toBe(true);
      await expect(db.recipeCover.count({ where: { recipeId: recipe.id } })).resolves.toBe(1);

      await expect(callSpoonjoyApiOperation(
        "create_recipe_cover_from_upload",
        {
          recipeId: recipe.id,
          imageUrl: dataUrl(GENERATED_BYTES),
          generateEditorial: false,
          idempotencyKey: "upload-cover-idempotent",
        },
        { db, principal: chef, allowLocalImageFallback: true },
      )).rejects.toMatchObject({
        status: 409,
        message: expect.stringMatching(/different request/i),
      });
    });

    it("replays no-key cover create and regenerate mutations without duplicate work", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const createArgs = {
        recipeId: recipe.id,
        imageUrl: dataUrl(),
        generateEditorial: false,
      };

      const firstCreate = await callSpoonjoyApiOperation(
        "create_recipe_cover_from_upload",
        createArgs,
        { db, principal: chef, allowLocalImageFallback: true },
      ) as { createdCover: { id: string }; mutation: { idempotencyKey: string | null; replayed: boolean } };
      const replayCreate = await callSpoonjoyApiOperation(
        "create_recipe_cover_from_upload",
        createArgs,
        { db, principal: chef, allowLocalImageFallback: true },
      ) as { createdCover: { id: string }; mutation: { idempotencyKey: string | null; replayed: boolean } };

      expect(replayCreate.createdCover.id).toBe(firstCreate.createdCover.id);
      expect(replayCreate.mutation).toEqual({ idempotencyKey: null, replayed: true });
      await expect(db.recipeCover.count({ where: { recipeId: recipe.id } })).resolves.toBe(1);

      const regenerateRecipe = await makeRecipe(db, chef.id);
      const cover = await db.recipeCover.create({
        data: {
          recipeId: regenerateRecipe.id,
          imageUrl: dataUrl(),
          sourceType: "chef-upload",
          sourceImageUrl: dataUrl(),
          status: "ready",
        },
      });
      const runner = imageRunner();
      const regenerateArgs = {
        recipeId: regenerateRecipe.id,
        coverId: cover.id,
        activateWhenReady: true,
      };

      const firstRegenerate = await callSpoonjoyApiOperation(
        "regenerate_recipe_cover",
        regenerateArgs,
        { db, principal: chef, allowLocalImageFallback: true, imageGenRunner: runner },
      ) as { createdCover: { id: string }; mutation: { idempotencyKey: string | null; replayed: boolean } };
      const replayRegenerate = await callSpoonjoyApiOperation(
        "regenerate_recipe_cover",
        regenerateArgs,
        { db, principal: chef, allowLocalImageFallback: true, imageGenRunner: runner },
      ) as { createdCover: { id: string }; mutation: { idempotencyKey: string | null; replayed: boolean } };

      expect(replayRegenerate.createdCover.id).toBe(firstRegenerate.createdCover.id);
      expect(replayRegenerate.mutation).toEqual({ idempotencyKey: null, replayed: true });
      expect(runner.imageToImage).toHaveBeenCalledTimes(1);
    });

    it("rejects in-flight idempotent cover mutations without creating duplicate work", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const body = {
        recipeId: recipe.id,
        imageUrl: dataUrl(),
        generateEditorial: false,
        idempotencyKey: "pending-cover-upload",
      };
      await db.apiIdempotencyKey.create({
        data: {
          userId: chef.id,
          clientKey: idempotencyClientKey(chef),
          key: "pending-cover-upload",
          operation: "create_recipe_cover_from_upload",
          requestHash: await mcpCoverMutationHash("create_recipe_cover_from_upload", recipe.id, body),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      await expect(callSpoonjoyApiOperation(
        "create_recipe_cover_from_upload",
        body,
        { db, principal: chef, allowLocalImageFallback: true },
      )).rejects.toMatchObject({
        status: 409,
        message: expect.stringMatching(/in progress/i),
      });
      await expect(db.recipeCover.count({ where: { recipeId: recipe.id } })).resolves.toBe(0);
    });

    it("validates cover mutation arguments and clears failed idempotency reservations", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);

      await expect(callSpoonjoyApiOperation(
        "create_recipe_cover_from_upload",
        { recipeId: "missing-recipe", imageUrl: dataUrl() },
        { db, principal: chef, allowLocalImageFallback: true },
      )).rejects.toMatchObject({ status: 404 });

      await expect(callSpoonjoyApiOperation(
        "create_recipe_cover_from_upload",
        { recipeId: recipe.id, imageUrl: dataUrl(), activate: "yes" },
        { db, principal: chef, allowLocalImageFallback: true },
      )).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/activate must be a boolean/i),
      });

      await expect(callSpoonjoyApiOperation(
        "create_recipe_cover_from_upload",
        {
          recipeId: recipe.id,
          imageUrl: `data:image/gif;base64,${Buffer.from("gif").toString("base64")}`,
          idempotencyKey: "invalid-image-cleans-reservation",
        },
        { db, principal: chef, allowLocalImageFallback: true },
      )).rejects.toMatchObject({ status: 400 });
      await expect(db.apiIdempotencyKey.count({ where: { key: "invalid-image-cleans-reservation" } })).resolves.toBe(0);

      const replayBody = {
        recipeId: recipe.id,
        imageUrl: dataUrl(),
        generateEditorial: false,
        idempotencyKey: "null-replay-body",
      };
      await db.apiIdempotencyKey.create({
        data: {
          userId: chef.id,
          clientKey: idempotencyClientKey(chef),
          key: "null-replay-body",
          operation: "create_recipe_cover_from_upload",
          requestHash: await mcpCoverMutationHash("create_recipe_cover_from_upload", recipe.id, replayBody),
          responseStatus: 200,
          responseBody: "null",
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      await expect(callSpoonjoyApiOperation(
        "create_recipe_cover_from_upload",
        replayBody,
        { db, principal: chef, allowLocalImageFallback: true },
      )).resolves.toBeNull();

      const replayObjectBody = {
        recipeId: recipe.id,
        imageUrl: dataUrl(),
        generateEditorial: false,
        idempotencyKey: "empty-object-replay-body",
      };
      await db.apiIdempotencyKey.create({
        data: {
          userId: chef.id,
          clientKey: idempotencyClientKey(chef),
          key: "empty-object-replay-body",
          operation: "create_recipe_cover_from_upload",
          requestHash: await mcpCoverMutationHash("create_recipe_cover_from_upload", recipe.id, replayObjectBody),
          responseStatus: 200,
          responseBody: "{}",
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      await expect(callSpoonjoyApiOperation(
        "create_recipe_cover_from_upload",
        replayObjectBody,
        { db, principal: chef, allowLocalImageFallback: true },
      )).resolves.toEqual({
        mutation: {
          idempotencyKey: "empty-object-replay-body",
          replayed: true,
        },
      });

      const { principal: sessionChef } = await makeUser(db, "session");
      const sessionRecipe = await makeRecipe(db, sessionChef.id);
      const sessionResult = await callSpoonjoyApiOperation(
        "create_recipe_cover_from_upload",
        {
          recipeId: sessionRecipe.id,
          imageUrl: dataUrl(),
          generateEditorial: false,
          idempotencyKey: "session-cover-upload",
        },
        { db, principal: sessionChef, allowLocalImageFallback: true },
      ) as { mutation: { idempotencyKey: string | null } };
      expect(sessionResult.mutation.idempotencyKey).toBe("session-cover-upload");
    });

    it("creates editorialized and verbatim upload covers only when explicitly activated", async () => {
      const { principal: chef } = await makeUser(db);
      const editorialRecipe = await makeRecipe(db, chef.id);
      const runner = imageRunner();

      const editorial = await callSpoonjoyApiOperation(
        "create_recipe_cover_from_upload",
        {
          recipeId: editorialRecipe.id,
          imageUrl: dataUrl(),
          activate: true,
        },
        { db, principal: chef, allowLocalImageFallback: true, imageGenRunner: runner },
      ) as {
        activeCover: { id: string; activeVariant: string | null } | null;
        createdCover: { id: string; generationStatus: string; status: string; stylizedImageUrl: string | null };
      };
      expect(runner.imageToImage).toHaveBeenCalledTimes(1);
      expect(editorial.createdCover).toMatchObject({
        status: "ready",
        generationStatus: "succeeded",
      });
      expect(editorial.createdCover.stylizedImageUrl).toBe(`data:image/png;base64,${Buffer.from(GENERATED_BYTES).toString("base64")}`);
      expect(editorial.activeCover).toMatchObject({
        id: editorial.createdCover.id,
        activeVariant: "stylized",
      });

      const candidateRecipe = await makeRecipe(db, chef.id);
      const candidate = await callSpoonjoyApiOperation(
        "create_recipe_cover_from_upload",
        {
          recipeId: candidateRecipe.id,
          imageUrl: dataUrl(),
        },
        { db, principal: chef, allowLocalImageFallback: true, imageGenRunner: runner },
      ) as {
        activeCover: null;
        createdCover: { generationStatus: string; status: string; stylizedImageUrl: string | null };
      };
      expect(runner.imageToImage).toHaveBeenCalledTimes(2);
      expect(candidate.activeCover).toBeNull();
      expect(candidate.createdCover).toMatchObject({
        status: "ready",
        generationStatus: "succeeded",
      });

      const verbatimRecipe = await makeRecipe(db, chef.id);
      const verbatim = await callSpoonjoyApiOperation(
        "create_recipe_cover_from_upload",
        {
          recipeId: verbatimRecipe.id,
          imageUrl: dataUrl(),
          activate: true,
          generateEditorial: false,
        },
        { db, principal: chef, allowLocalImageFallback: true },
      ) as {
        activeCover: { id: string; activeVariant: string | null } | null;
        createdCover: { id: string; generationStatus: string; status: string; stylizedImageUrl: string | null };
      };
      expect(verbatim.createdCover).toMatchObject({
        status: "ready",
        generationStatus: "none",
        stylizedImageUrl: null,
      });
      expect(verbatim.activeCover).toMatchObject({
        id: verbatim.createdCover.id,
        activeVariant: "image",
      });
    });

    it("keeps legacy recipe image uploads active as verbatim covers when no stylized URL is available at activation", async () => {
      const { principal: chef } = await makeUser(db);
      const apiRecipeCover = Object.assign(Object.create(db.recipeCover), {
        findUnique: vi.fn(async () => ({ stylizedImageUrl: null })),
      }) as Database["recipeCover"];
      const apiDb = Object.assign(Object.create(db), { recipeCover: apiRecipeCover }) as Database;
      const runner = imageRunner();
      const created = await callSpoonjoyApiOperation(
        "create_recipe",
        {
          title: `Verbatim Legacy Cover ${faker.string.alphanumeric(6)}`,
          imageUrl: dataUrl(),
        },
        { db: apiDb, principal: chef, allowLocalImageFallback: true, imageGenRunner: runner },
      ) as { recipe: { id: string; imageUrl: string | null; coverVariant: string | null } };
      const cover = await db.recipeCover.findFirstOrThrow({
        where: { recipeId: created.recipe.id },
      });

      expect(created.recipe).toMatchObject({
        imageUrl: dataUrl(),
        coverVariant: "image",
      });
      expect(cover).toMatchObject({
        imageUrl: dataUrl(),
        stylizedImageUrl: `data:image/png;base64,${Buffer.from(GENERATED_BYTES).toString("base64")}`,
        generationStatus: "succeeded",
        failureReason: null,
      });
      expect(apiRecipeCover.findUnique).toHaveBeenCalledWith({
        where: { id: cover.id },
        select: { stylizedImageUrl: true },
      });
      await expect(db.recipe.findUniqueOrThrow({
        where: { id: created.recipe.id },
        select: { activeCoverId: true, activeCoverVariant: true, coverMode: true },
      })).resolves.toEqual({
        activeCoverId: cover.id,
        activeCoverVariant: "image",
        coverMode: "manual",
      });
    });

    it("validates spoon cover dry-runs, missing sources, and editorial candidates", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const spoon = await db.recipeSpoon.create({
        data: {
          recipeId: recipe.id,
          chefId: chef.id,
          photoUrl: dataUrl(),
        },
      });

      const dryRun = await callSpoonjoyApiOperation(
        "create_recipe_cover_from_spoon",
        {
          recipeId: recipe.id,
          spoonId: spoon.id,
          dryRun: true,
        },
        { db, principal: chef },
      ) as { createdCover: null; generationStatus: string; nextActions: string[] };
      expect(dryRun).toMatchObject({
        createdCover: null,
        generationStatus: "dry_run",
      });
      expect(dryRun.nextActions).toContain("create_recipe_cover_from_spoon");
      await expect(db.recipeCover.count({ where: { recipeId: recipe.id } })).resolves.toBe(0);

      await expect(callSpoonjoyApiOperation(
        "create_recipe_cover_from_spoon",
        { recipeId: recipe.id, spoonId: "missing-spoon" },
        { db, principal: chef },
      )).rejects.toMatchObject({ status: 404 });

      const runner = imageRunner();
      const candidate = await callSpoonjoyApiOperation(
        "create_recipe_cover_from_spoon",
        {
          recipeId: recipe.id,
          spoonId: spoon.id,
        },
        { db, principal: chef, allowLocalImageFallback: true, imageGenRunner: runner },
      ) as {
        activeCover: null;
        createdCover: { id: string; generationStatus: string; status: string; stylizedImageUrl: string | null };
      };
      expect(runner.imageToImage).toHaveBeenCalledTimes(1);
      expect(candidate.activeCover).toBeNull();
      expect(candidate.createdCover).toMatchObject({
        status: "ready",
        generationStatus: "succeeded",
      });
      expect(candidate.createdCover.stylizedImageUrl).toBe(`data:image/png;base64,${Buffer.from(GENERATED_BYTES).toString("base64")}`);

      const activatedRecipe = await makeRecipe(db, chef.id);
      const activatedSpoon = await db.recipeSpoon.create({
        data: {
          recipeId: activatedRecipe.id,
          chefId: chef.id,
          photoUrl: dataUrl(),
        },
      });
      const activated = await callSpoonjoyApiOperation(
        "create_recipe_cover_from_spoon",
        {
          recipeId: activatedRecipe.id,
          spoonId: activatedSpoon.id,
          activate: true,
        },
        { db, principal: chef, allowLocalImageFallback: true, imageGenRunner: runner },
      ) as {
        activeCover: { id: string; activeVariant: string | null } | null;
        createdCover: { id: string; generationStatus: string };
      };
      expect(activated.createdCover.generationStatus).toBe("succeeded");
      expect(activated.activeCover).toMatchObject({
        id: activated.createdCover.id,
        activeVariant: "stylized",
      });

      const verbatimRecipe = await makeRecipe(db, chef.id);
      const verbatimSpoon = await db.recipeSpoon.create({
        data: {
          recipeId: verbatimRecipe.id,
          chefId: chef.id,
          photoUrl: "/photos/spoons/verbatim-candidate.jpg",
        },
      });
      const verbatim = await callSpoonjoyApiOperation(
        "create_recipe_cover_from_spoon",
        {
          recipeId: verbatimRecipe.id,
          spoonId: verbatimSpoon.id,
          generateEditorial: false,
        },
        { db, principal: chef },
      ) as {
        activeCover: null;
        createdCover: { generationStatus: string; stylizedImageUrl: string | null };
      };
      expect(verbatim.activeCover).toBeNull();
      expect(verbatim.createdCover).toMatchObject({
        generationStatus: "none",
        stylizedImageUrl: null,
      });
    });

    it("validates regenerate dry-runs and missing or invalid cover states", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const cover = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: dataUrl(),
          sourceType: "chef-upload",
          sourceImageUrl: dataUrl(),
          status: "ready",
        },
      });

      const dryRun = await callSpoonjoyApiOperation(
        "regenerate_recipe_cover",
        {
          recipeId: recipe.id,
          coverId: cover.id,
          dryRun: true,
        },
        { db, principal: chef },
      ) as { createdCover: { id: string }; generationStatus: string; nextActions: string[] };
      expect(dryRun).toMatchObject({
        createdCover: { id: cover.id },
        generationStatus: "dry_run",
      });
      expect(dryRun.nextActions).toContain("regenerate_recipe_cover");

      await expect(callSpoonjoyApiOperation(
        "regenerate_recipe_cover",
        { recipeId: recipe.id, coverId: "missing-cover" },
        { db, principal: chef },
      )).rejects.toMatchObject({ status: 404 });

      await expect(callSpoonjoyApiOperation(
        "get_cover_generation_status",
        { recipeId: recipe.id, coverId: "missing-cover" },
        { db, principal: chef },
      )).rejects.toMatchObject({ status: 404 });

      const archived = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: dataUrl(),
          sourceType: "chef-upload",
          status: "archived",
          archivedAt: new Date(),
        },
      });
      await expect(callSpoonjoyApiOperation(
        "regenerate_recipe_cover",
        { recipeId: recipe.id, coverId: archived.id },
        { db, principal: chef },
      )).rejects.toMatchObject({ status: 400 });

      const emptySource = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "",
          sourceType: "chef-upload",
          status: "ready",
        },
      });
      await expect(callSpoonjoyApiOperation(
        "regenerate_recipe_cover",
        { recipeId: recipe.id, coverId: emptySource.id },
        { db, principal: chef },
      )).rejects.toMatchObject({ status: 400 });

      const spoonCover = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: dataUrl(),
          sourceType: "spoon",
          status: "ready",
        },
      });
      const runner = imageRunner();
      const regeneratedSpoon = await callSpoonjoyApiOperation(
        "regenerate_recipe_cover",
        {
          recipeId: recipe.id,
          coverId: spoonCover.id,
        },
        { db, principal: chef, allowLocalImageFallback: true, imageGenRunner: runner },
      ) as { activeCover: null; createdCover: { generationStatus: string; stylizedImageUrl: string | null } };
      expect(regeneratedSpoon.activeCover).toBeNull();
      expect(regeneratedSpoon.createdCover).toMatchObject({
        generationStatus: "succeeded",
        stylizedImageUrl: `data:image/png;base64,${Buffer.from(GENERATED_BYTES).toString("base64")}`,
      });
      await expect(db.recipeCover.findUniqueOrThrow({
        where: { id: spoonCover.id },
        select: { sourceImageUrl: true },
      })).resolves.toEqual({ sourceImageUrl: dataUrl() });
    });

    it("sets active covers with idempotent replay and owner checks", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: cook } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const current = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "/photos/current.jpg",
          sourceType: "chef-upload",
          status: "ready",
        },
      });
      const replacement = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "/photos/replacement.jpg",
          stylizedImageUrl: "/photos/replacement-editorial.jpg",
          sourceType: "chef-upload",
          status: "ready",
          generationStatus: "succeeded",
        },
      });
      await db.recipe.update({
        where: { id: recipe.id },
        data: { activeCoverId: current.id, activeCoverVariant: "image", coverMode: "manual" },
      });
      const args = {
        recipeId: recipe.id,
        coverId: replacement.id,
        variant: "stylized",
      };

      const first = await callSpoonjoyApiOperation(
        "set_active_recipe_cover",
        args,
        { db, principal: chef },
      ) as {
        activeCover: { id: string; activeVariant: string | null };
        previousActiveCover: { id: string; activeVariant: string | null } | null;
        archivedCover: null;
        warnings: string[];
        nextActions: string[];
        mutation: { idempotencyKey: string | null; replayed: boolean };
      };
      const replay = await callSpoonjoyApiOperation(
        "set_active_recipe_cover",
        args,
        { db, principal: chef },
      ) as typeof first;

      expect(first).toMatchObject({
        activeCover: { id: replacement.id, activeVariant: "stylized" },
        previousActiveCover: { id: current.id, activeVariant: "image" },
        archivedCover: null,
        warnings: [],
        mutation: { idempotencyKey: null, replayed: false },
      });
      expect(first.nextActions).toContain("list_recipe_covers");
      expect(replay.activeCover.id).toBe(first.activeCover.id);
      expect(replay.mutation).toEqual({ idempotencyKey: null, replayed: true });
      await expect(db.recipe.findUniqueOrThrow({
        where: { id: recipe.id },
        select: { activeCoverId: true, activeCoverVariant: true, coverMode: true },
      })).resolves.toEqual({
        activeCoverId: replacement.id,
        activeCoverVariant: "stylized",
        coverMode: "manual",
      });

      await expect(callSpoonjoyApiOperation(
        "set_active_recipe_cover",
        { recipeId: recipe.id, coverId: current.id, variant: "image" },
        { db, principal: cook },
      )).rejects.toMatchObject({ status: 403 });
    });

    it("archives inactive covers with idempotent replay", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const active = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "/photos/active.jpg",
          sourceType: "chef-upload",
          status: "ready",
        },
      });
      const inactive = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "/photos/inactive.jpg",
          sourceType: "chef-upload",
          status: "ready",
        },
      });
      await db.recipe.update({
        where: { id: recipe.id },
        data: { activeCoverId: active.id, activeCoverVariant: "image", coverMode: "manual" },
      });
      const args = { recipeId: recipe.id, coverId: inactive.id };

      const first = await callSpoonjoyApiOperation(
        "archive_recipe_cover",
        args,
        { db, principal: chef },
      ) as {
        activeCover: { id: string } | null;
        previousActiveCover: { id: string } | null;
        archivedCover: { id: string; status: string; archivedAt: string | null };
        warnings: string[];
        nextActions: string[];
        mutation: { idempotencyKey: string | null; replayed: boolean };
      };
      const replay = await callSpoonjoyApiOperation(
        "archive_recipe_cover",
        args,
        { db, principal: chef },
      ) as typeof first;

      expect(first).toMatchObject({
        activeCover: { id: active.id },
        previousActiveCover: { id: active.id },
        archivedCover: { id: inactive.id, status: "archived" },
        warnings: [],
        mutation: { idempotencyKey: null, replayed: false },
      });
      expect(first.archivedCover.archivedAt).toEqual(expect.any(String));
      expect(first.nextActions).toContain("list_recipe_covers");
      expect(replay.archivedCover.id).toBe(first.archivedCover.id);
      expect(replay.mutation).toEqual({ idempotencyKey: null, replayed: true });
      await expect(db.recipeCover.count({
        where: { recipeId: recipe.id, status: "archived" },
      })).resolves.toBe(1);
    });

    it("archives active covers only with explicit no-cover or replacement choices", async () => {
      const { principal: chef } = await makeUser(db);
      const noCoverRecipe = await makeRecipe(db, chef.id);
      const active = await db.recipeCover.create({
        data: {
          recipeId: noCoverRecipe.id,
          imageUrl: "/photos/active.jpg",
          sourceType: "chef-upload",
          status: "ready",
        },
      });
      await db.recipe.update({
        where: { id: noCoverRecipe.id },
        data: { activeCoverId: active.id, activeCoverVariant: "image", coverMode: "manual" },
      });

      const noCover = await callSpoonjoyApiOperation(
        "archive_recipe_cover",
        { recipeId: noCoverRecipe.id, coverId: active.id, confirmNoCover: true },
        { db, principal: chef },
      ) as {
        activeCover: null;
        previousActiveCover: { id: string } | null;
        archivedCover: { id: string; status: string };
      };
      expect(noCover).toMatchObject({
        activeCover: null,
        previousActiveCover: { id: active.id },
        archivedCover: { id: active.id, status: "archived" },
      });
      await expect(db.recipe.findUniqueOrThrow({
        where: { id: noCoverRecipe.id },
        select: { activeCoverId: true, activeCoverVariant: true, coverMode: true },
      })).resolves.toEqual({
        activeCoverId: null,
        activeCoverVariant: null,
        coverMode: "none",
      });

      const replacementRecipe = await makeRecipe(db, chef.id);
      const oldActive = await db.recipeCover.create({
        data: {
          recipeId: replacementRecipe.id,
          imageUrl: "/photos/old-active.jpg",
          sourceType: "chef-upload",
          status: "ready",
        },
      });
      const replacement = await db.recipeCover.create({
        data: {
          recipeId: replacementRecipe.id,
          imageUrl: "/photos/new-active.jpg",
          stylizedImageUrl: "/photos/new-active-editorial.jpg",
          sourceType: "chef-upload",
          status: "ready",
          generationStatus: "succeeded",
        },
      });
      await db.recipe.update({
        where: { id: replacementRecipe.id },
        data: { activeCoverId: oldActive.id, activeCoverVariant: "image", coverMode: "manual" },
      });

      const replaced = await callSpoonjoyApiOperation(
        "archive_recipe_cover",
        {
          recipeId: replacementRecipe.id,
          coverId: oldActive.id,
          replacementCoverId: replacement.id,
          replacementVariant: "stylized",
        },
        { db, principal: chef },
      ) as {
        activeCover: { id: string; activeVariant: string | null } | null;
        previousActiveCover: { id: string } | null;
        archivedCover: { id: string; status: string };
      };
      expect(replaced).toMatchObject({
        activeCover: { id: replacement.id, activeVariant: "stylized" },
        previousActiveCover: { id: oldActive.id },
        archivedCover: { id: oldActive.id, status: "archived" },
      });
      await expect(db.recipe.findUniqueOrThrow({
        where: { id: replacementRecipe.id },
        select: { activeCoverId: true, activeCoverVariant: true, coverMode: true },
      })).resolves.toEqual({
        activeCoverId: replacement.id,
        activeCoverVariant: "stylized",
        coverMode: "manual",
      });
    });

    it("validates active-cover mutations and rejects idempotency conflicts", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const active = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "/photos/active.jpg",
          sourceType: "chef-upload",
          status: "ready",
        },
      });
      const replacement = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "/photos/replacement.jpg",
          sourceType: "chef-upload",
          status: "ready",
        },
      });
      await db.recipe.update({
        where: { id: recipe.id },
        data: { activeCoverId: active.id, activeCoverVariant: "image", coverMode: "manual" },
      });

      await expect(callSpoonjoyApiOperation(
        "archive_recipe_cover",
        { recipeId: recipe.id, coverId: active.id },
        { db, principal: chef },
      )).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/requires a replacement or confirmNoCover/i),
      });
      await expect(callSpoonjoyApiOperation(
        "archive_recipe_cover",
        { recipeId: recipe.id, coverId: active.id, confirmNoCover: true, dryRun: true },
        { db, principal: chef },
      )).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/dryRun is not allowed/i),
      });
      await expect(callSpoonjoyApiOperation(
        "set_active_recipe_cover",
        { recipeId: recipe.id, coverId: replacement.id, variant: "poster" },
        { db, principal: chef },
      )).rejects.toMatchObject({ status: 400 });

      const setArgs = {
        recipeId: recipe.id,
        coverId: replacement.id,
        variant: "image",
        idempotencyKey: "set-cover-conflict",
      };
      const firstSet = await callSpoonjoyApiOperation(
        "set_active_recipe_cover",
        setArgs,
        { db, principal: chef },
      ) as { activeCover: { id: string }; mutation: { replayed: boolean } };
      const replaySet = await callSpoonjoyApiOperation(
        "set_active_recipe_cover",
        setArgs,
        { db, principal: chef },
      ) as typeof firstSet;
      expect(replaySet.activeCover.id).toBe(firstSet.activeCover.id);
      expect(replaySet.mutation.replayed).toBe(true);

      await expect(callSpoonjoyApiOperation(
        "set_active_recipe_cover",
        { ...setArgs, coverId: active.id },
        { db, principal: chef },
      )).rejects.toMatchObject({
        status: 409,
        message: expect.stringMatching(/different request/i),
      });

      const inactive = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "/photos/inactive.jpg",
          sourceType: "chef-upload",
          status: "ready",
        },
      });
      const archiveArgs = {
        recipeId: recipe.id,
        coverId: inactive.id,
        idempotencyKey: "archive-in-flight",
      };
      await db.apiIdempotencyKey.create({
        data: {
          userId: chef.id,
          clientKey: idempotencyClientKey(chef),
          key: "archive-in-flight",
          operation: "archive_recipe_cover",
          requestHash: await mcpCoverMutationHash("archive_recipe_cover", recipe.id, archiveArgs),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      await expect(callSpoonjoyApiOperation(
        "archive_recipe_cover",
        archiveArgs,
        { db, principal: chef },
      )).rejects.toMatchObject({
        status: 409,
        message: expect.stringMatching(/in progress/i),
      });
      await expect(db.recipeCover.findUniqueOrThrow({
        where: { id: inactive.id },
        select: { status: true, archivedAt: true },
      })).resolves.toEqual({ status: "ready", archivedAt: null });

      const disposable = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "/photos/disposable.jpg",
          sourceType: "chef-upload",
          status: "ready",
        },
      });
      const warned = await callSpoonjoyApiOperation(
        "archive_recipe_cover",
        {
          recipeId: recipe.id,
          coverId: disposable.id,
          deleteSafeObjects: true,
          idempotencyKey: "archive-delete-safe-warning",
        },
        { db, principal: chef },
      ) as { warnings: string[] };
      expect(warned.warnings).toEqual([
        expect.stringMatching(/not implemented/i),
      ]);

      const apiErrorDb = {
        ...db,
        recipe: {
          ...db.recipe,
          update: async () => {
            throw new ApiAuthError("custom lifecycle failure", 418);
          },
        },
      } as unknown as Database;
      await expect(callSpoonjoyApiOperation(
        "set_active_recipe_cover",
        {
          recipeId: recipe.id,
          coverId: active.id,
          variant: "image",
          idempotencyKey: "set-cover-api-error",
        },
        { db: apiErrorDb, principal: chef },
      )).rejects.toMatchObject({
        status: 418,
        message: "custom lifecycle failure",
      });

      const rawErrorDb = {
        ...db,
        recipe: {
          ...db.recipe,
          update: async () => {
            throw "raw lifecycle failure";
          },
        },
      } as unknown as Database;
      await expect(callSpoonjoyApiOperation(
        "set_active_recipe_cover",
        {
          recipeId: recipe.id,
          coverId: active.id,
          variant: "image",
          idempotencyKey: "set-cover-raw-error",
        },
        { db: rawErrorDb, principal: chef },
      )).rejects.toMatchObject({
        status: 400,
        message: "Cover mutation failed",
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
      }, context) as {
        spoon: { id: string; photoUrl: string };
        cover: { id: string; imageUrl: string; stylizedImageUrl: string | null };
      };

      expect(created.spoon.photoUrl).toBe(`data:image/png;base64,${Buffer.from(VALID_PNG_BYTES).toString("base64")}`);
      expect(created.cover.imageUrl).toBe(created.spoon.photoUrl);
      expect(captured).toHaveLength(0);
      let cover = await db.recipeCover.findUniqueOrThrow({ where: { id: created.cover.id } });
      expect(cover.stylizedImageUrl).toBe(`data:image/png;base64,${Buffer.from(GENERATED_BYTES).toString("base64")}`);
      expect(created.cover.stylizedImageUrl).toBe(cover.stylizedImageUrl);

      const updated = await callSpoonjoyApiOperation("update_spoon", {
        spoonId: created.spoon.id,
        photoUrl: uploaded.imageUrl,
      }, context) as { cover: { id: string; imageUrl: string; stylizedImageUrl: string | null } };

      expect(updated.cover.imageUrl).toBe(uploaded.imageUrl);
      expect(captured).toHaveLength(0);
      cover = await db.recipeCover.findUniqueOrThrow({ where: { id: updated.cover.id } });
      expect(cover.stylizedImageUrl).toBe(`data:image/png;base64,${Buffer.from(GENERATED_BYTES).toString("base64")}`);
      expect(updated.cover.stylizedImageUrl).toBe(cover.stylizedImageUrl);
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

    it("allows an origin-cook note without a photo and creates no cover", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const context: SpoonjoyApiContext = { db, principal: chef };

      const result = (await callSpoonjoyApiOperation(
        "create_spoon",
        { recipeId: recipe.id, note: "looks good" },
        context,
      )) as { spoon: { chefId: string; note: string; photoUrl: string | null }; isOriginCook: boolean; cover: unknown };

      expect(result.spoon).toMatchObject({
        chefId: chef.id,
        note: "looks good",
        photoUrl: null,
      });
      expect(result.isOriginCook).toBe(true);
      expect(result.cover).toBeNull();
      await expect(db.recipeCover.findMany({ where: { recipeId: recipe.id } })).resolves.toEqual([]);
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

    it("runs stylization inline even when context.waitUntil is available", async () => {
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
      )) as { cover: { id: string; stylizedImageUrl: string | null } };

      expect(waitUntil).not.toHaveBeenCalled();
      expect(captured).toHaveLength(0);

      const updatedCover = await db.recipeCover.findUniqueOrThrow({
        where: { id: result.cover.id },
      });
      expect(updatedCover.stylizedImageUrl).toMatch(/^\/photos\/covers\/\d+-[a-f0-9-]+\.png$/);
      expect(result.cover.stylizedImageUrl).toBe(updatedCover.stylizedImageUrl);
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
      )) as { cover: { id: string; stylizedImageUrl: string | null } };

      const updatedCover = await db.recipeCover.findUniqueOrThrow({
        where: { id: result.cover.id },
      });
      expect(updatedCover.stylizedImageUrl).toMatch(/^\/photos\/covers\/\d+-[a-f0-9-]+\.png$/);
      expect(result.cover.stylizedImageUrl).toBe(updatedCover.stylizedImageUrl);
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

    it("awaits the owner NotificationEvent inline when waitUntil is unavailable", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: cook } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);

      await callSpoonjoyApiOperation(
        "create_spoon",
        { recipeId: recipe.id, note: "yum" },
        {
          db,
          principal: cook,
          env: {
            VAPID_PUBLIC_KEY: "pub",
            VAPID_PRIVATE_KEY: "priv",
            VAPID_SUBJECT: "mailto:test@example.com",
          },
        },
      );

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
      )) as {
        spoon: { photoUrl: string };
        cover: { id: string; imageUrl: string; stylizedImageUrl: string | null };
      };

      expect(result.spoon.photoUrl).toBe(uploaded.imageUrl);
      expect(result.cover.imageUrl).toBe(uploaded.imageUrl);
      const activeCover = await db.recipeCover.findUniqueOrThrow({ where: { id: result.cover.id } });
      expect(activeCover).toMatchObject({
        recipeId: recipe.id,
        sourceType: "spoon",
        sourceSpoonId: existing.id,
        imageUrl: uploaded.imageUrl,
      });
      expect(activeCover.stylizedImageUrl).toMatch(/^\/photos\/covers\/\d+-[a-f0-9-]+\.png$/);
      expect(result.cover.stylizedImageUrl).toBe(activeCover.stylizedImageUrl);
      expect(captured).toHaveLength(0);
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
      const activeCover = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "/photos/raw.jpg",
          stylizedImageUrl: "/photos/editorial.jpg",
          sourceType: "spoon",
          status: "ready",
          generationStatus: "succeeded",
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
      await db.recipeSpoon.create({
        data: { chefId: cook.id, recipeId: recipe.id, note: "hi" },
      });
      const context: SpoonjoyApiContext = { db, principal: cook };
      const result = (await callSpoonjoyApiOperation(
        "list_spoons_for_recipe",
        { recipeId: recipe.id },
        context,
      )) as {
        spoons: Array<{
          chef: { username: string };
          coverImageUrl: string | null;
          coverProvenanceLabel: string | null;
          coverSourceType: string | null;
          coverVariant: string | null;
          coverStatus: string | null;
          coverGenerationStatus: string | null;
        }>;
      };
      expect(result.spoons).toHaveLength(1);
      expect(result.spoons[0].chef.username).toBe(cook.username);
      expect(result.spoons[0]).toMatchObject({
        coverImageUrl: "/photos/editorial.jpg",
        coverProvenanceLabel: "Editorialized chef photo",
        coverSourceType: "spoon",
        coverVariant: "stylized",
        coverStatus: "ready",
        coverGenerationStatus: "succeeded",
      });
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

    it("returns null cover provenance when the recipe has no active cover", async () => {
      const { principal: chef } = await makeUser(db);
      const { principal: cook } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      await db.recipeSpoon.create({
        data: { chefId: cook.id, recipeId: recipe.id, note: "no cover yet" },
      });
      const context: SpoonjoyApiContext = { db, principal: cook };
      const result = (await callSpoonjoyApiOperation(
        "list_spoons_for_recipe",
        { recipeId: recipe.id },
        context,
      )) as {
        spoons: Array<{
          coverImageUrl: string | null;
          coverProvenanceLabel: string | null;
          coverSourceType: string | null;
          coverVariant: string | null;
          coverStatus: string | null;
          coverGenerationStatus: string | null;
        }>;
      };

      expect(result.spoons).toEqual([
        expect.objectContaining({
          coverImageUrl: null,
          coverProvenanceLabel: null,
          coverSourceType: null,
          coverVariant: null,
          coverStatus: null,
          coverGenerationStatus: null,
        }),
      ]);
    });
  });

  describe("list_spoons_by_chef", () => {
    it("returns spoons by chef id with recipe + coverImageUrl preloaded", async () => {
      const { principal: chef } = await makeUser(db);
      const recipe = await makeRecipe(db, chef.id);
      const cover = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "/photos/original.jpg",
          sourceType: "chef-upload",
          status: "ready",
        },
      });
      await db.recipe.update({
        where: { id: recipe.id },
        data: { activeCoverId: cover.id, activeCoverVariant: "image", coverMode: "manual" },
      });
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
      )) as {
        spoons: Array<{
          recipe: { id: string; title: string };
          coverImageUrl: string | null;
          coverProvenanceLabel: string | null;
          coverSourceType: string | null;
          coverVariant: string | null;
          coverStatus: string | null;
          coverGenerationStatus: string | null;
        }>;
      };
      expect(result.spoons).toHaveLength(1);
      expect(result.spoons[0].recipe.id).toBe(recipe.id);
      expect(result.spoons[0].recipe.title).toBe(recipe.title);
      expect(result.spoons[0]).toMatchObject({
        coverImageUrl: "/photos/original.jpg",
        coverProvenanceLabel: "Chef photo",
        coverSourceType: "chef-upload",
        coverVariant: "image",
        coverStatus: "ready",
        coverGenerationStatus: "none",
      });
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
