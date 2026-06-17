import { describe, expect, it, vi } from "vitest";
import { uploadNativeRecipeImageCover } from "~/lib/api-v1-recipe-covers.server";

const VALID_PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function createMemoryPhotosBucket() {
  const stored = new Map<string, { value: unknown; options?: unknown }>();
  const puts: Array<{ key: string; value: unknown; options: unknown }> = [];
  const deletes: string[] = [];
  return {
    puts,
    deletes,
    bucket: {
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
