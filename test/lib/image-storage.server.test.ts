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

  const textEncoder = new TextEncoder();

  function jpegWithSegments(segments: Uint8Array[], scanData = new Uint8Array([0xff, 0xda, 0x00, 0x02, 0x11, 0x22])) {
    return new Uint8Array([
      0xff,
      0xd8,
      ...segments.flatMap((segment) => Array.from(segment)),
      ...scanData,
    ]);
  }

  function jpegSegment(marker: number, payload: string): Uint8Array {
    const payloadBytes = textEncoder.encode(payload);
    const length = payloadBytes.length + 2;

    return new Uint8Array([
      0xff,
      marker,
      (length >> 8) & 0xff,
      length & 0xff,
      ...payloadBytes,
    ]);
  }

  async function fileBytes(file: File): Promise<Uint8Array> {
    return new Uint8Array(await file.arrayBuffer());
  }

  function bytesAsText(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes);
  }

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
        randomId: () => "upload-1",
      });

      expect(imageUrl).toBe("/photos/recipes/user-1/recipe-1/12345-upload-1.webp");
      expect(bucket.put).toHaveBeenCalledWith(
        "recipes/user-1/recipe-1/12345-upload-1.webp",
        file,
        { httpMetadata: { contentType: "image/webp" } }
      );
    });

    it("strips JPEG APP1 metadata before uploading to R2", async () => {
      const bucket = {
        put: vi.fn().mockResolvedValue(undefined),
      };
      const imageBytes = jpegWithSegments([
        jpegSegment(0xe0, "JFIF public header"),
        jpegSegment(0xe1, "Exif\0\0GPSLatitude private location"),
      ]);
      const file = new File([imageBytes], "dish.jpg", { type: "image/jpeg" });

      const imageUrl = await storeImage({
        bucket: bucket as unknown as R2Bucket,
        file,
        namespace: "spoons/user-1/recipe-1",
        now: () => 24680,
        randomId: () => "upload-2",
      });

      expect(imageUrl).toBe("/photos/spoons/user-1/recipe-1/24680-upload-2.jpg");
      const uploadedFile = bucket.put.mock.calls[0][1] as File;
      expect(uploadedFile).not.toBe(file);
      expect(uploadedFile.type).toBe("image/jpeg");
      const uploadedText = bytesAsText(await fileBytes(uploadedFile));
      expect(uploadedText).toContain("JFIF public header");
      expect(uploadedText).not.toContain("GPSLatitude");
    });

    it("strips JPEG APP1 metadata before falling back to a local data URL", async () => {
      const imageBytes = jpegWithSegments([
        jpegSegment(0xe1, "Exif\0\0GPSLongitude private location"),
      ]);

      const imageUrl = await storeImage({
        file: new File([imageBytes], "local.jpg", { type: "image/jpeg" }),
        namespace: "recipes/user-1/recipe-1",
      });

      const encoded = imageUrl.replace("data:image/jpeg;base64,", "");
      const decoded = bytesAsText(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)));
      expect(decoded).not.toContain("GPSLongitude");
    });

    it("leaves JPEG uploads unchanged when they have no APP1 metadata", async () => {
      const bucket = {
        put: vi.fn().mockResolvedValue(undefined),
      };
      const file = new File(
        [jpegWithSegments([jpegSegment(0xe0, "JFIF public header")])],
        "plain.jpeg",
        { type: "image/jpeg" },
      );

      await storeImage({
        bucket: bucket as unknown as R2Bucket,
        file,
        namespace: "recipes/user-1/recipe-1",
        now: () => 13579,
      });

      expect(bucket.put.mock.calls[0][1]).toBe(file);
    });

    it("leaves malformed JPEG uploads unchanged instead of corrupting them", async () => {
      const bucket = {
        put: vi.fn().mockResolvedValue(undefined),
      };
      const malformed = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x20, 0x45, 0x78]);
      const file = new File([malformed], "truncated.jpg", { type: "image/jpeg" });

      await storeImage({
        bucket: bucket as unknown as R2Bucket,
        file,
        namespace: "recipes/user-1/recipe-1",
        now: () => 97531,
      });

      expect(bucket.put.mock.calls[0][1]).toBe(file);
    });

    it("does not strip APP1-like bytes once JPEG scan data has started", async () => {
      const bucket = {
        put: vi.fn().mockResolvedValue(undefined),
      };
      const imageBytes = jpegWithSegments([], new Uint8Array([
        0xff,
        0xda,
        0x00,
        0x02,
        0xff,
        0xe1,
        ...textEncoder.encode("scan bytes"),
      ]));
      const file = new File([imageBytes], "scan.jpg", { type: "image/jpeg" });

      await storeImage({
        bucket: bucket as unknown as R2Bucket,
        file,
        namespace: "recipes/user-1/recipe-1",
        now: () => 11223,
      });

      expect(bucket.put.mock.calls[0][1]).toBe(file);
    });

    it("falls back to a data URL when no bucket is available", async () => {
      const imageUrl = await storeImage({
        file: new File(["abc"], "local.jpg", { type: "image/jpeg" }),
        namespace: "recipes/user-1/recipe-1",
      });

      expect(imageUrl).toBe("data:image/jpeg;base64,YWJj");
    });

    it("uses random ids so same-millisecond uploads do not overwrite each other", async () => {
      const bucket = {
        put: vi.fn().mockResolvedValue(undefined),
      };
      const file = new File(["image"], "dish.png", { type: "image/png" });
      const ids = ["first", "second"];

      const first = await storeImage({
        bucket: bucket as unknown as R2Bucket,
        file,
        namespace: "recipes/user-1/recipe-1",
        now: () => 12345,
        randomId: () => ids.shift() ?? "fallback",
      });
      const second = await storeImage({
        bucket: bucket as unknown as R2Bucket,
        file,
        namespace: "recipes/user-1/recipe-1",
        now: () => 12345,
        randomId: () => ids.shift() ?? "fallback",
      });

      expect(first).toBe("/photos/recipes/user-1/recipe-1/12345-first.png");
      expect(second).toBe("/photos/recipes/user-1/recipe-1/12345-second.png");
      expect(bucket.put.mock.calls.map((call) => call[0])).toEqual([
        "recipes/user-1/recipe-1/12345-first.png",
        "recipes/user-1/recipe-1/12345-second.png",
      ]);
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
