import { describe, it, expect, vi } from "vitest";
import { loader } from "~/routes/photos.$";

describe("Photos Resource Route", () => {
  describe("loader", () => {
    it("should return 404 when no key is provided", async () => {
      await expect(
        loader({
          params: { "*": "" },
          context: { cloudflare: { env: null } },
          request: new Request("http://localhost:3000/photos/"),
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(404);
        return true;
      });
    });

    it("should return 404 when key is undefined", async () => {
      await expect(
        loader({
          params: {},
          context: { cloudflare: { env: null } },
          request: new Request("http://localhost:3000/photos/"),
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(404);
        return true;
      });
    });

    it("should return 503 when R2 bucket is not available", async () => {
      await expect(
        loader({
          params: { "*": "profiles/user123/image.jpg" },
          context: { cloudflare: { env: null } },
          request: new Request("http://localhost:3000/photos/profiles/user123/image.jpg"),
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(503);
        return true;
      });
    });

    it("should return 503 when context is missing", async () => {
      await expect(
        loader({
          params: { "*": "profiles/user123/image.jpg" },
          context: {},
          request: new Request("http://localhost:3000/photos/profiles/user123/image.jpg"),
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(503);
        return true;
      });
    });

    it("should return 404 when photo is not found in R2", async () => {
      const mockR2Bucket = {
        get: vi.fn().mockResolvedValue(null),
      };

      await expect(
        loader({
          params: { "*": "profiles/user123/nonexistent.jpg" },
          context: { cloudflare: { env: { PHOTOS: mockR2Bucket } } },
          request: new Request("http://localhost:3000/photos/profiles/user123/nonexistent.jpg"),
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(404);
        return true;
      });

      expect(mockR2Bucket.get).toHaveBeenCalledWith("profiles/user123/nonexistent.jpg");
    });

    it("should return photo with correct headers when found in R2", async () => {
      const mockBody = new ReadableStream();
      const mockR2Object = {
        body: mockBody,
        size: 0,
        httpEtag: '"etag-1"',
        httpMetadata: {
          contentType: "image/jpeg",
        },
      };
      const mockR2Bucket = {
        get: vi.fn().mockResolvedValue(mockR2Object),
      };

      const result = await loader({
        params: { "*": "profiles/user123/photo.jpg" },
        context: { cloudflare: { env: { PHOTOS: mockR2Bucket } } },
        request: new Request("http://localhost:3000/photos/profiles/user123/photo.jpg"),
      } as any);

      expect(result).toBeInstanceOf(Response);
      expect(result.headers.get("Content-Type")).toBe("image/jpeg");
      expect(result.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
      expect(result.headers.get("ETag")).toBe('"etag-1"');
      expect(mockR2Bucket.get).toHaveBeenCalledWith("profiles/user123/photo.jpg");
    });

    it("serves the size variant ?w= asks for and keeps it at the edge through waitUntil", async () => {
      const variant = { body: new Response("webp").body, size: 4, httpEtag: '"etag-v"', httpMetadata: {} };
      const mockR2Bucket = {
        get: vi.fn(async (key: string) => (key === "variants/w512/covers/photo.jpg.webp" ? variant : null)),
      };
      const put = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("caches", { default: { match: vi.fn().mockResolvedValue(undefined), put } });
      const waitUntil = vi.fn();
      const ctx = { waitUntil };

      try {
        const result = await loader({
          params: { "*": "covers/photo.jpg" },
          context: { cloudflare: { env: { PHOTOS: mockR2Bucket }, ctx } },
          request: new Request("http://localhost:3000/photos/covers/photo.jpg?w=400"),
        } as any);

        expect(await result.text()).toBe("webp");
        expect(result.headers.get("Content-Type")).toBe("image/webp");
        expect(result.headers.get("X-Spoonjoy-Photo-Variant")).toBe("w512");
        expect(put).toHaveBeenCalledTimes(1);
        expect(waitUntil).toHaveBeenCalledTimes(1);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("should default to image/jpeg when httpMetadata.contentType is not set", async () => {
      const mockBody = new ReadableStream();
      const mockR2Object = {
        body: mockBody,
        size: 0,
        httpEtag: '"etag-1"',
        httpMetadata: {},
      };
      const mockR2Bucket = {
        get: vi.fn().mockResolvedValue(mockR2Object),
      };

      const result = await loader({
        params: { "*": "profiles/user123/photo.jpg" },
        context: { cloudflare: { env: { PHOTOS: mockR2Bucket } } },
        request: new Request("http://localhost:3000/photos/profiles/user123/photo.jpg"),
      } as any);

      expect(result.headers.get("Content-Type")).toBe("image/jpeg");
    });

    it("should default to image/jpeg when httpMetadata is undefined", async () => {
      const mockBody = new ReadableStream();
      const mockR2Object = {
        body: mockBody,
        size: 0,
        httpEtag: '"etag-1"',
        httpMetadata: undefined,
      };
      const mockR2Bucket = {
        get: vi.fn().mockResolvedValue(mockR2Object),
      };

      const result = await loader({
        params: { "*": "profiles/user123/photo.jpg" },
        context: { cloudflare: { env: { PHOTOS: mockR2Bucket } } },
        request: new Request("http://localhost:3000/photos/profiles/user123/photo.jpg"),
      } as any);

      expect(result.headers.get("Content-Type")).toBe("image/jpeg");
    });

    it("should preserve content type for PNG images", async () => {
      const mockBody = new ReadableStream();
      const mockR2Object = {
        body: mockBody,
        size: 0,
        httpEtag: '"etag-1"',
        httpMetadata: {
          contentType: "image/png",
        },
      };
      const mockR2Bucket = {
        get: vi.fn().mockResolvedValue(mockR2Object),
      };

      const result = await loader({
        params: { "*": "profiles/user123/photo.png" },
        context: { cloudflare: { env: { PHOTOS: mockR2Bucket } } },
        request: new Request("http://localhost:3000/photos/profiles/user123/photo.png"),
      } as any);

      expect(result.headers.get("Content-Type")).toBe("image/png");
    });
  });
});
