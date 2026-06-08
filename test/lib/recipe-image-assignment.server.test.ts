import { describe, expect, it, vi } from "vitest";
import {
  validateRecipeImageAssignment,
  validateSpoonPhotoAssignment,
} from "~/lib/recipe-image-assignment.server";
import { validateFoodImageDataUrl } from "~/lib/image-upload-tools.server";

const VALID_PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 1, 2, 3]);

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function dataUrl(contentType: string, bytes: Uint8Array): string {
  return `data:${contentType};base64,${b64(bytes)}`;
}

function bucketWithKeys(keys: string[]): R2Bucket {
  const stored = new Set(keys);
  return {
    get: vi.fn(async (key: string) => stored.has(key) ? ({}) : null),
  } as unknown as R2Bucket;
}

describe("recipe image assignment validation", () => {
  it("validates explicit local/test data URLs through the shared food-photo validator", async () => {
    await expect(validateFoodImageDataUrl("not a data url")).rejects.toThrow(
      "Image data URL must be a valid food photo.",
    );
    await expect(validateFoodImageDataUrl(dataUrl("image/png", GIF_BYTES))).rejects.toThrow(
      "Photos must be JPG, PNG, or WebP.",
    );
    await expect(validateFoodImageDataUrl(dataUrl("image/png", VALID_PNG_BYTES))).resolves.toBeUndefined();
  });

  it("accepts assignment data URLs only when bucket-backed storage is absent", async () => {
    const bucket = bucketWithKeys([]);
    await expect(validateRecipeImageAssignment({
      imageUrl: dataUrl("image/png", VALID_PNG_BYTES),
      ownerId: "u",
      bucket,
      allowLocalImageFallback: true,
    })).rejects.toThrow("Data URL recipe images require missing bucket storage and explicit local image fallback.");
    await expect(validateSpoonPhotoAssignment({
      photoUrl: dataUrl("image/png", VALID_PNG_BYTES),
      ownerId: "u",
      bucket,
      allowLocalImageFallback: true,
    })).rejects.toThrow("Data URL spoon photos require missing bucket storage and explicit local image fallback.");
    await expect(validateRecipeImageAssignment({
      imageUrl: dataUrl("image/png", VALID_PNG_BYTES),
      ownerId: "u",
      allowLocalImageFallback: true,
    })).resolves.toBeUndefined();
    await expect(validateSpoonPhotoAssignment({
      photoUrl: dataUrl("image/png", VALID_PNG_BYTES),
      ownerId: "u",
      allowLocalImageFallback: true,
    })).resolves.toEqual({ stylizable: true });
  });

  it("rejects unclean uploaded recipe image URLs before storage lookup", async () => {
    const bucket = bucketWithKeys([]);
    const cases = [
      "/photos/recipes/u/uploads/raw.png?sig=1",
      "/photos/recipes/u/uploads/raw.png#frag",
      "/photos/recipes/u/uploads/%E0%A4%A",
      "/photos/recipes/u/uploads/%2E%2E/raw.png",
      "/photos/recipes/u/uploads\\raw.png",
      "/photos/recipes/u//raw.png",
      "/photos/recipes/u/./raw.png",
      "/photos/recipes/u/../raw.png",
    ];

    for (const imageUrl of cases) {
      await expect(validateRecipeImageAssignment({
        imageUrl,
        ownerId: "u",
        bucket,
      })).rejects.toThrow("Recipe imageUrl must be a clean Spoonjoy uploaded image URL.");
    }
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("requires stored recipe assignment URLs to be owner-scoped and present in R2", async () => {
    const existing = bucketWithKeys(["recipes/u/uploads/raw.png", "spoons/u/uploads/raw.png"]);

    await expect(validateRecipeImageAssignment({
      imageUrl: "/photos/recipes/u/uploads/raw.png",
      ownerId: "u",
      bucket: existing,
    })).resolves.toBeUndefined();
    await expect(validateRecipeImageAssignment({
      imageUrl: "/photos/spoons/u/uploads/raw.png",
      ownerId: "u",
      bucket: existing,
    })).resolves.toBeUndefined();
    await expect(validateRecipeImageAssignment({
      imageUrl: "/photos/recipes/u/uploads/raw.png",
      ownerId: "u",
    })).rejects.toMatchObject({
      status: 503,
      message: "Stored recipe image assignment requires the PHOTOS bucket.",
    });
  });

  it("rejects unsafe spoon photo assignments while keeping external URLs backward-compatible", async () => {
    const existing = bucketWithKeys(["spoons/u/uploads/raw.png"]);

    await expect(validateSpoonPhotoAssignment({
      photoUrl: "https://stub.test/raw.png",
      ownerId: "u",
      bucket: existing,
    })).resolves.toEqual({ stylizable: false });
    await expect(validateSpoonPhotoAssignment({
      photoUrl: dataUrl("image/png", VALID_PNG_BYTES),
      ownerId: "u",
    })).rejects.toThrow("Data URL spoon photos require missing bucket storage and explicit local image fallback.");
    await expect(validateSpoonPhotoAssignment({
      photoUrl: "/photos/spoons/other/uploads/raw.png",
      ownerId: "u",
      bucket: existing,
    })).rejects.toThrow("Spoon photoUrl must belong to the spoon owner.");
    await expect(validateSpoonPhotoAssignment({
      photoUrl: "/photos/spoons/u/uploads/raw.png",
      ownerId: "u",
    })).rejects.toMatchObject({
      status: 503,
      message: "Stored spoon photo assignment requires the PHOTOS bucket.",
    });
    await expect(validateSpoonPhotoAssignment({
      photoUrl: "/photos/spoons/u/uploads/missing.png",
      ownerId: "u",
      bucket: existing,
    })).rejects.toThrow("Spoon photoUrl does not exist in storage.");
    await expect(validateSpoonPhotoAssignment({
      photoUrl: "/photos/spoons/u/uploads/raw.png",
      ownerId: "u",
      bucket: existing,
    })).resolves.toEqual({ stylizable: true });
  });
});
