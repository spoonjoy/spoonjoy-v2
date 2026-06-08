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

  function app1Segment(payloadBytes: Uint8Array): Uint8Array {
    const length = payloadBytes.length + 2;
    return new Uint8Array([
      0xff,
      0xe1,
      (length >> 8) & 0xff,
      length & 0xff,
      ...payloadBytes,
    ]);
  }

  function exifPayloadWithIfdOffset(ifdOffset: number): Uint8Array {
    const payloadBytes = new Uint8Array(32);
    payloadBytes.set(textEncoder.encode("Exif\0\0"), 0);
    payloadBytes.set(textEncoder.encode("MM"), 6);
    payloadBytes[8] = 0x00;
    payloadBytes[9] = 0x2a;
    payloadBytes[10] = (ifdOffset >> 24) & 0xff;
    payloadBytes[11] = (ifdOffset >> 16) & 0xff;
    payloadBytes[12] = (ifdOffset >> 8) & 0xff;
    payloadBytes[13] = ifdOffset & 0xff;
    return payloadBytes;
  }

  function exifPayloadWithInvalidEndian(): Uint8Array {
    const payloadBytes = exifPayloadWithIfdOffset(8);
    payloadBytes[6] = 0x5a;
    payloadBytes[7] = 0x5a;
    return payloadBytes;
  }

  function exifPayloadWithInvalidMagic(): Uint8Array {
    const payloadBytes = exifPayloadWithIfdOffset(8);
    payloadBytes[8] = 0x00;
    payloadBytes[9] = 0x2b;
    return payloadBytes;
  }

  function exifPayloadWithoutOrientation(): Uint8Array {
    const payloadBytes = exifPayloadWithIfdOffset(8);
    payloadBytes[14] = 0x00;
    payloadBytes[15] = 0x01;
    payloadBytes[16] = 0x99;
    payloadBytes[17] = 0x99;
    payloadBytes[18] = 0x00;
    payloadBytes[19] = 0x03;
    payloadBytes[20] = 0x00;
    payloadBytes[21] = 0x00;
    payloadBytes[22] = 0x00;
    payloadBytes[23] = 0x01;
    payloadBytes[24] = 0x00;
    payloadBytes[25] = 0x06;
    return payloadBytes;
  }

  function exifPayloadWithTruncatedEntry(): Uint8Array {
    const payloadBytes = exifPayloadWithoutOrientation();
    payloadBytes[15] = 0x02;
    return payloadBytes;
  }

  function exifOrientationSegment(orientation: number, privatePayload = "GPSLatitude private location"): Uint8Array {
    const payloadBytes = new Uint8Array(32 + textEncoder.encode(privatePayload).length);
    payloadBytes.set(textEncoder.encode("Exif\0\0"), 0);
    payloadBytes.set(textEncoder.encode("MM"), 6);
    payloadBytes[8] = 0x00;
    payloadBytes[9] = 0x2a;
    payloadBytes[10] = 0x00;
    payloadBytes[11] = 0x00;
    payloadBytes[12] = 0x00;
    payloadBytes[13] = 0x08;
    payloadBytes[14] = 0x00;
    payloadBytes[15] = 0x01;
    payloadBytes[16] = 0x01;
    payloadBytes[17] = 0x12;
    payloadBytes[18] = 0x00;
    payloadBytes[19] = 0x03;
    payloadBytes[20] = 0x00;
    payloadBytes[21] = 0x00;
    payloadBytes[22] = 0x00;
    payloadBytes[23] = 0x01;
    payloadBytes[24] = 0x00;
    payloadBytes[25] = orientation;
    payloadBytes[26] = 0x00;
    payloadBytes[27] = 0x00;
    payloadBytes.set(textEncoder.encode(privatePayload), 32);

    return new Uint8Array([
      0xff,
      0xe1,
      ((payloadBytes.length + 2) >> 8) & 0xff,
      (payloadBytes.length + 2) & 0xff,
      ...payloadBytes,
    ]);
  }

  function littleEndianExifOrientationSegment(orientation: number): Uint8Array {
    const payloadBytes = new Uint8Array(32);
    payloadBytes.set(textEncoder.encode("Exif\0\0"), 0);
    payloadBytes.set(textEncoder.encode("II"), 6);
    payloadBytes[8] = 0x2a;
    payloadBytes[9] = 0x00;
    payloadBytes[10] = 0x08;
    payloadBytes[11] = 0x00;
    payloadBytes[12] = 0x00;
    payloadBytes[13] = 0x00;
    payloadBytes[14] = 0x01;
    payloadBytes[15] = 0x00;
    payloadBytes[16] = 0x12;
    payloadBytes[17] = 0x01;
    payloadBytes[18] = 0x03;
    payloadBytes[19] = 0x00;
    payloadBytes[20] = 0x01;
    payloadBytes[21] = 0x00;
    payloadBytes[22] = 0x00;
    payloadBytes[23] = 0x00;
    payloadBytes[24] = orientation;
    payloadBytes[25] = 0x00;
    return app1Segment(payloadBytes);
  }

  function getJpegApp1Payloads(bytes: Uint8Array): Uint8Array[] {
    const payloads: Uint8Array[] = [];
    let offset = 2;
    while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
      const segmentEnd = offset + 2 + segmentLength;
      if (segmentLength < 2 || segmentEnd > bytes.length) break;
      if (marker === 0xe1) {
        payloads.push(bytes.subarray(offset + 4, segmentEnd));
      }
      offset = segmentEnd;
    }
    return payloads;
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
    it("uses a food-photo allow-list that does not include GIF", () => {
      expect(RECIPE_IMAGE_TYPES).toEqual(["image/jpeg", "image/png", "image/webp"]);
      expect(RECIPE_IMAGE_TYPES).not.toContain("image/gif");
    });

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

  describe("validateImageFileForStorage", () => {
    it("accepts food-photo bytes when MIME type and magic bytes match", async () => {
      const storage = await import("~/lib/image-storage.server");
      const validateImageFileForStorage = (storage as unknown as {
        validateImageFileForStorage: (
          file: File,
          options: Parameters<typeof validateImageFile>[1],
        ) => Promise<string | null>;
      }).validateImageFileForStorage;

      await expect(validateImageFileForStorage(
        new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "photo.jpg", { type: "image/jpeg" }),
        { allowedTypes: RECIPE_IMAGE_TYPES, messages },
      )).resolves.toBeNull();
      await expect(validateImageFileForStorage(
        new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "photo.png", { type: "image/png" }),
        { allowedTypes: RECIPE_IMAGE_TYPES, messages },
      )).resolves.toBeNull();
      await expect(validateImageFileForStorage(
        new File([new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])], "photo.webp", { type: "image/webp" }),
        { allowedTypes: RECIPE_IMAGE_TYPES, messages },
      )).resolves.toBeNull();
    });

    it("rejects GIF bytes disguised as accepted food-photo types", async () => {
      const gifBytes = textEncoder.encode("GIF89a");
      const storage = await import("~/lib/image-storage.server");
      expect(storage).toHaveProperty("validateImageFileForStorage");
      const validateImageFileForStorage = (storage as unknown as {
        validateImageFileForStorage: (
          file: File,
          options: Parameters<typeof validateImageFile>[1],
        ) => Promise<string | null>;
      }).validateImageFileForStorage;

      await expect(validateImageFileForStorage(
        new File([gifBytes], "fake.png", { type: "image/png" }),
        { allowedTypes: RECIPE_IMAGE_TYPES, messages },
      )).resolves.toBe("Invalid image format");
      await expect(validateImageFileForStorage(
        new File([gifBytes], "fake.jpg", { type: "image/jpeg" }),
        { allowedTypes: RECIPE_IMAGE_TYPES, messages },
      )).resolves.toBe("Invalid image format");
    });

    it("rejects unknown bytes even when the MIME type is allowed", async () => {
      const storage = await import("~/lib/image-storage.server");
      const validateImageFileForStorage = (storage as unknown as {
        validateImageFileForStorage: (
          file: File,
          options: Parameters<typeof validateImageFile>[1],
        ) => Promise<string | null>;
      }).validateImageFileForStorage;

      await expect(validateImageFileForStorage(
        new File([new Uint8Array([0x00])], "fake.webp", { type: "image/webp" }),
        { allowedTypes: RECIPE_IMAGE_TYPES, messages },
      )).resolves.toBe("Invalid image format");
    });

    it("rejects empty files before storage even when the MIME type is allowed", async () => {
      const storage = await import("~/lib/image-storage.server");
      expect(storage).toHaveProperty("validateImageFileForStorage");
      const validateImageFileForStorage = (storage as unknown as {
        validateImageFileForStorage: (
          file: File,
          options: Parameters<typeof validateImageFile>[1],
        ) => Promise<string | null>;
      }).validateImageFileForStorage;

      await expect(validateImageFileForStorage(
        new File([], "empty.jpg", { type: "image/jpeg" }),
        { allowedTypes: RECIPE_IMAGE_TYPES, messages },
      )).resolves.toBe("Invalid image format");
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

    it("drops malformed or unrelated EXIF APP1 payloads instead of preserving private metadata", async () => {
      const malformedOrUnrelatedApp1Segments = [
        app1Segment(new Uint8Array([0x01])),
        app1Segment(textEncoder.encode("not exif")),
        app1Segment(exifPayloadWithInvalidEndian()),
        app1Segment(exifPayloadWithInvalidMagic()),
        app1Segment(exifPayloadWithIfdOffset(999)),
        app1Segment(exifPayloadWithTruncatedEntry()),
        app1Segment(exifPayloadWithoutOrientation()),
        exifOrientationSegment(1),
      ];

      for (const [index, segment] of malformedOrUnrelatedApp1Segments.entries()) {
        const imageBytes = jpegWithSegments([
          jpegSegment(0xe0, "JFIF public header"),
          segment,
        ]);

        const imageUrl = await storeImage({
          file: new File([imageBytes], `malformed-${index}.jpg`, { type: "image/jpeg" }),
          namespace: "recipes/user-1/recipe-1",
        });

        const encoded = imageUrl.replace("data:image/jpeg;base64,", "");
        const decodedBytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
        expect(getJpegApp1Payloads(decodedBytes)).toHaveLength(0);
        expect(bytesAsText(decodedBytes)).toContain("JFIF public header");
      }
    });

    it("preserves a sanitized EXIF Orientation tag while stripping private APP1 metadata before uploading to R2", async () => {
      const bucket = {
        put: vi.fn().mockResolvedValue(undefined),
      };
      const imageBytes = jpegWithSegments([
        jpegSegment(0xe0, "JFIF public header"),
        exifOrientationSegment(6),
      ]);
      const file = new File([imageBytes], "upright.jpg", { type: "image/jpeg" });

      await storeImage({
        bucket: bucket as unknown as R2Bucket,
        file,
        namespace: "recipes/user-1/recipe-1",
        now: () => 12345,
        randomId: () => "upload-orientation",
      });

      const uploadedFile = bucket.put.mock.calls[0][1] as File;
      const uploadedBytes = await fileBytes(uploadedFile);
      const uploadedText = bytesAsText(uploadedBytes);
      const app1Payloads = getJpegApp1Payloads(uploadedBytes);

      expect(uploadedFile).not.toBe(file);
      expect(app1Payloads).toHaveLength(1);
      expect(app1Payloads[0].subarray(0, 6)).toEqual(textEncoder.encode("Exif\0\0"));
      expect(app1Payloads[0][25]).toBe(6);
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

    it("preserves sanitized EXIF Orientation metadata before falling back to a local data URL", async () => {
      const imageBytes = jpegWithSegments([
        exifOrientationSegment(6, "CameraSerial private data"),
      ]);

      const imageUrl = await storeImage({
        file: new File([imageBytes], "local-upright.jpg", { type: "image/jpeg" }),
        namespace: "recipes/user-1/recipe-1",
      });

      const encoded = imageUrl.replace("data:image/jpeg;base64,", "");
      const decodedBytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      const decodedText = bytesAsText(decodedBytes);
      const app1Payloads = getJpegApp1Payloads(decodedBytes);

      expect(app1Payloads).toHaveLength(1);
      expect(app1Payloads[0][25]).toBe(6);
      expect(decodedText).not.toContain("CameraSerial");
    });

    it("preserves sanitized EXIF Orientation from little-endian JPEG metadata", async () => {
      const imageBytes = jpegWithSegments([
        littleEndianExifOrientationSegment(8),
      ]);

      const imageUrl = await storeImage({
        file: new File([imageBytes], "little-endian.jpg", { type: "image/jpeg" }),
        namespace: "recipes/user-1/recipe-1",
      });

      const encoded = imageUrl.replace("data:image/jpeg;base64,", "");
      const decodedBytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      const app1Payloads = getJpegApp1Payloads(decodedBytes);

      expect(app1Payloads).toHaveLength(1);
      expect(app1Payloads[0][25]).toBe(8);
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
