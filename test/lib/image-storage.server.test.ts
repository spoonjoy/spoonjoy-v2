import { describe, it, expect, vi } from "vitest";
import {
  deleteStoredImage,
  getImageExtension,
  getStoredImageKey,
  hasUploadedImageFile,
  RECIPE_IMAGE_TYPES,
  storeImage,
  validateImageFile,
} from "~/lib/image-storage.server";

describe("image storage helpers", () => {
  const messages = {
    invalidType: "Invalid image format",
    fileTooLarge: "Image must be less than 5MB",
  };

  describe("hasUploadedImageFile", () => {
    it("returns true only for non-empty File values", () => {
      expect(hasUploadedImageFile(new File(["image"], "photo.jpg", { type: "image/jpeg" }))).toBe(true);
      expect(hasUploadedImageFile(new File([], "empty.jpg", { type: "image/jpeg" }))).toBe(false);
      expect(hasUploadedImageFile("not-a-file")).toBe(false);
      expect(hasUploadedImageFile(null)).toBe(false);
    });
  });

  describe("validateImageFile", () => {
    it("accepts allowed recipe image types", () => {
      for (const type of RECIPE_IMAGE_TYPES) {
        expect(validateImageFile(new File(["image"], "photo.jpg", { type }), {
          allowedTypes: RECIPE_IMAGE_TYPES,
          messages,
        })).toBeNull();
      }
    });

    it("rejects files outside an explicit allow-list", () => {
      expect(validateImageFile(new File(["image"], "photo.bmp", { type: "image/bmp" }), {
        allowedTypes: RECIPE_IMAGE_TYPES,
        messages,
      })).toBe("Invalid image format");
    });

    it("uses image/* validation when no allow-list is provided", () => {
      expect(validateImageFile(new File(["image"], "photo.bmp", { type: "image/bmp" }), {
        messages,
      })).toBeNull();
      expect(validateImageFile(new File(["text"], "notes.txt", { type: "text/plain" }), {
        messages,
      })).toBe("Invalid image format");
    });

    it("rejects files over the 5MB limit", () => {
      const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "huge.jpg", { type: "image/jpeg" });

      expect(validateImageFile(oversized, {
        allowedTypes: RECIPE_IMAGE_TYPES,
        messages,
      })).toBe("Image must be less than 5MB");
    });
  });

  describe("getImageExtension", () => {
    it("normalizes file extensions and falls back to jpg", () => {
      expect(getImageExtension("photo.PNG")).toBe("png");
      expect(getImageExtension("photo.")).toBe("jpg");
      expect(getImageExtension("photo")).toBe("jpg");
    });
  });

  describe("storeImage", () => {
    it("uploads to R2 and returns a served photo URL when a bucket is available", async () => {
      const bucket = {
        put: vi.fn().mockResolvedValue(undefined),
      };
      const file = new File(["image"], "dish.webp", { type: "image/webp" });

      const imageUrl = await storeImage({
        bucket: bucket as unknown as R2Bucket,
        file,
        namespace: "recipes/user-1/recipe-1",
        now: () => 12345,
      });

      expect(imageUrl).toBe("/photos/recipes/user-1/recipe-1/12345.webp");
      expect(bucket.put).toHaveBeenCalledWith(
        "recipes/user-1/recipe-1/12345.webp",
        file,
        { httpMetadata: { contentType: "image/webp" } }
      );
    });

    it("falls back to a data URL when no bucket is available", async () => {
      const imageUrl = await storeImage({
        file: new File(["abc"], "local.jpg", { type: "image/jpeg" }),
        namespace: "recipes/user-1/recipe-1",
      });

      expect(imageUrl).toBe("data:image/jpeg;base64,YWJj");
    });
  });

  describe("deleteStoredImage", () => {
    it("extracts keys from served photo URLs", () => {
      expect(getStoredImageKey("/photos/recipes/user-1/recipe-1/photo.jpg")).toBe("recipes/user-1/recipe-1/photo.jpg");
      expect(getStoredImageKey("data:image/jpeg;base64,YWJj")).toBeNull();
      expect(getStoredImageKey(null)).toBeNull();
    });

    it("deletes R2-backed images when a bucket and key are available", async () => {
      const bucket = {
        delete: vi.fn().mockResolvedValue(undefined),
      };

      await expect(deleteStoredImage({
        bucket: bucket as unknown as R2Bucket,
        imageUrl: "/photos/recipes/user-1/recipe-1/photo.jpg",
      })).resolves.toBe(true);
      expect(bucket.delete).toHaveBeenCalledWith("recipes/user-1/recipe-1/photo.jpg");
    });

    it("skips deletion when no bucket or R2 key is available", async () => {
      const bucket = {
        delete: vi.fn().mockResolvedValue(undefined),
      };

      await expect(deleteStoredImage({ imageUrl: "/photos/recipes/user-1/recipe-1/photo.jpg" })).resolves.toBe(false);
      await expect(deleteStoredImage({
        bucket: bucket as unknown as R2Bucket,
        imageUrl: "https://example.com/photo.jpg",
      })).resolves.toBe(false);
      expect(bucket.delete).not.toHaveBeenCalled();
    });
  });
});
