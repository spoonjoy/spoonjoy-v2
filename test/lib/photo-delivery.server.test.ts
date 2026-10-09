import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultPhotoCache,
  deliverPhoto,
  PHOTO_EDGE_CACHE_CONTROL,
  PHOTO_FALLBACK_CACHE_CONTROL,
  PHOTO_IMMUTABLE_CACHE_CONTROL,
  photoKeyFromPath,
} from "~/lib/photo-delivery.server";

function storedObject(text: string, { etag = '"etag-1"', contentType }: { etag?: string; contentType?: string | null } = {}) {
  return {
    body: new Response(text).body,
    size: text.length,
    httpEtag: etag,
    httpMetadata: contentType === null ? undefined : { contentType: contentType ?? "image/png" },
  };
}

function bucketWith(objects: Record<string, ReturnType<typeof storedObject>>) {
  return {
    get: vi.fn(async (key: string) => objects[key] ?? null),
  } as unknown as R2Bucket & { get: ReturnType<typeof vi.fn> };
}

function memoryCache() {
  const entries = new Map<string, Response>();
  return {
    entries,
    match: vi.fn(async (request: Request) => entries.get(request.url)?.clone()),
    put: vi.fn(async (request: Request, response: Response) => {
      entries.set(request.url, new Response(await response.arrayBuffer(), response));
    }),
  } as unknown as Cache & { entries: Map<string, Response>; match: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
}

const ORIGINAL = "covers/1-a.png";
const W512 = "variants/w512/covers/1-a.png.webp";

function request(path: string, init?: RequestInit) {
  return new Request(`https://spoonjoy.app${path}`, init);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("deliverPhoto", () => {
  it("serves the original with an ETag and a year-long client lifetime, and keeps it at the edge", async () => {
    const bucket = bucketWith({ [ORIGINAL]: storedObject("original") });
    const cache = memoryCache();
    const pending: Promise<unknown>[] = [];

    const response = await deliverPhoto({
      request: request(`/photos/${ORIGINAL}?utm=1`),
      key: ORIGINAL,
      bucket,
      cache,
      waitUntil: (promise) => pending.push(promise),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("original");
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Length")).toBe("8");
    expect(response.headers.get("ETag")).toBe('"etag-1"');
    expect(response.headers.get("Cache-Control")).toBe(PHOTO_IMMUTABLE_CACHE_CONTROL);
    expect(response.headers.get("X-Spoonjoy-Photo-Cache")).toBe("miss");
    expect(response.headers.get("X-Spoonjoy-Photo-Variant")).toBe("original");
    expect(bucket.get).toHaveBeenCalledWith(ORIGINAL);

    await Promise.all(pending);
    const kept = cache.entries.get(`https://spoonjoy.app/photos/${ORIGINAL}`);
    expect(kept?.headers.get("Cache-Control")).toBe(PHOTO_EDGE_CACHE_CONTROL);
    expect(await kept?.text()).toBe("original");
  });

  it("answers a later request from the edge with the client lifetime restored", async () => {
    const bucket = bucketWith({ [ORIGINAL]: storedObject("original") });
    const cache = memoryCache();
    await deliverPhoto({ request: request(`/photos/${ORIGINAL}`), key: ORIGINAL, bucket, cache });
    bucket.get.mockClear();

    const response = await deliverPhoto({ request: request(`/photos/${ORIGINAL}`), key: ORIGINAL, bucket, cache });

    expect(bucket.get).not.toHaveBeenCalled();
    expect(await response.text()).toBe("original");
    expect(response.headers.get("X-Spoonjoy-Photo-Cache")).toBe("hit");
    expect(response.headers.get("Cache-Control")).toBe(PHOTO_IMMUTABLE_CACHE_CONTROL);
  });

  it("serves the variant a width rounds up to", async () => {
    const bucket = bucketWith({ [W512]: storedObject("variant", { etag: '"etag-v"' }), [ORIGINAL]: storedObject("original") });
    const cache = memoryCache();

    const response = await deliverPhoto({ request: request(`/photos/${ORIGINAL}?w=300`), key: ORIGINAL, bucket, cache });

    expect(await response.text()).toBe("variant");
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("ETag")).toBe('"etag-v"');
    expect(response.headers.get("X-Spoonjoy-Photo-Variant")).toBe("w512");
    expect(response.headers.get("Cache-Control")).toBe(PHOTO_IMMUTABLE_CACHE_CONTROL);
    expect(bucket.get).toHaveBeenCalledTimes(1);
    expect(cache.entries.has(`https://spoonjoy.app/photos/${ORIGINAL}?w=512`)).toBe(true);
  });

  it("falls back to the original, cached briefly, until the variant exists", async () => {
    const bucket = bucketWith({ [ORIGINAL]: storedObject("original") });
    const cache = memoryCache();

    const response = await deliverPhoto({ request: request(`/photos/${ORIGINAL}?w=512`), key: ORIGINAL, bucket, cache });

    expect(await response.text()).toBe("original");
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("X-Spoonjoy-Photo-Variant")).toBe("original");
    expect(response.headers.get("Cache-Control")).toBe(PHOTO_FALLBACK_CACHE_CONTROL);
    expect(bucket.get.mock.calls.map(([key]) => key)).toEqual([W512, ORIGINAL]);
    expect(cache.entries.get(`https://spoonjoy.app/photos/${ORIGINAL}?w=512`)?.headers.get("Cache-Control")).toBe(
      PHOTO_FALLBACK_CACHE_CONTROL,
    );

    const again = await deliverPhoto({ request: request(`/photos/${ORIGINAL}?w=512`), key: ORIGINAL, bucket, cache });
    expect(again.headers.get("X-Spoonjoy-Photo-Cache")).toBe("hit");
    expect(again.headers.get("Cache-Control")).toBe(PHOTO_FALLBACK_CACHE_CONTROL);
  });

  it("serves a variant key as it is, ignoring a width", async () => {
    const bucket = bucketWith({ [W512]: storedObject("variant", { contentType: "image/webp" }) });

    const response = await deliverPhoto({ request: request(`/photos/${W512}?w=256`), key: W512, bucket });

    expect(await response.text()).toBe("variant");
    expect(bucket.get).toHaveBeenCalledWith(W512);
    expect(bucket.get).toHaveBeenCalledTimes(1);
  });

  it("ignores a malformed width", async () => {
    const bucket = bucketWith({ [ORIGINAL]: storedObject("original") });

    const response = await deliverPhoto({ request: request(`/photos/${ORIGINAL}?w=big`), key: ORIGINAL, bucket });

    expect(response.headers.get("Cache-Control")).toBe(PHOTO_IMMUTABLE_CACHE_CONTROL);
    expect(bucket.get).toHaveBeenCalledWith(ORIGINAL);
  });

  it("defaults the content type to JPEG when the original has none", async () => {
    const bucket = bucketWith({ [ORIGINAL]: storedObject("original", { contentType: null }) });
    const response = await deliverPhoto({ request: request(`/photos/${ORIGINAL}`), key: ORIGINAL, bucket });
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("answers 404 without caching for a missing photo", async () => {
    const bucket = bucketWith({});
    const cache = memoryCache();

    const response = await deliverPhoto({ request: request("/photos/missing.jpg"), key: "missing.jpg", bucket, cache });

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("answers 304 when the client already has the photo, from R2 and from the edge", async () => {
    const bucket = bucketWith({ [ORIGINAL]: storedObject("original") });
    const cache = memoryCache();

    const fromR2 = await deliverPhoto({
      request: request(`/photos/${ORIGINAL}`, { headers: { "If-None-Match": '"etag-1"' } }),
      key: ORIGINAL,
      bucket,
      cache,
    });
    expect(fromR2.status).toBe(304);
    expect(fromR2.headers.get("ETag")).toBe('"etag-1"');
    expect(fromR2.headers.get("Cache-Control")).toBe(PHOTO_IMMUTABLE_CACHE_CONTROL);
    expect(fromR2.headers.get("X-Spoonjoy-Photo-Cache")).toBe("miss");
    expect(fromR2.headers.has("Content-Type")).toBe(false);

    const fromEdge = await deliverPhoto({
      request: request(`/photos/${ORIGINAL}`, { headers: { "If-None-Match": 'W/"other", W/"etag-1"' } }),
      key: ORIGINAL,
      bucket,
      cache,
    });
    expect(fromEdge.status).toBe(304);
    expect(fromEdge.headers.get("X-Spoonjoy-Photo-Cache")).toBe("hit");

    const wildcard = await deliverPhoto({
      request: request(`/photos/${ORIGINAL}`, { headers: { "If-None-Match": "*" } }),
      key: ORIGINAL,
      bucket,
      cache,
    });
    expect(wildcard.status).toBe(304);
  });

  it("serves the photo when the client's ETag is stale", async () => {
    const bucket = bucketWith({ [ORIGINAL]: storedObject("original") });

    const response = await deliverPhoto({
      request: request(`/photos/${ORIGINAL}`, { headers: { "If-None-Match": '"old"' } }),
      key: ORIGINAL,
      bucket,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("original");
  });

  it("answers HEAD with headers only and still keeps the photo at the edge", async () => {
    const bucket = bucketWith({ [ORIGINAL]: storedObject("original") });
    const cache = memoryCache();

    const response = await deliverPhoto({ request: request(`/photos/${ORIGINAL}`, { method: "HEAD" }), key: ORIGINAL, bucket, cache });

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get("ETag")).toBe('"etag-1"');
    expect(await cache.entries.get(`https://spoonjoy.app/photos/${ORIGINAL}`)?.text()).toBe("original");
  });

  it("still serves the photo when the edge refuses to keep it", async () => {
    const bucket = bucketWith({ [ORIGINAL]: storedObject("original") });
    const cache = memoryCache();
    cache.put.mockRejectedValueOnce(new Error("cache full"));

    const response = await deliverPhoto({ request: request(`/photos/${ORIGINAL}`), key: ORIGINAL, bucket, cache });

    expect(await response.text()).toBe("original");
  });
});

describe("photoKeyFromPath", () => {
  it("reads the decoded R2 key from a /photos/ path", () => {
    expect(photoKeyFromPath("/photos/covers/1-a%20b.jpg")).toBe("covers/1-a b.jpg");
  });

  it("returns null for other paths, an empty key and undecodable paths", () => {
    expect(photoKeyFromPath("/recipes/1")).toBeNull();
    expect(photoKeyFromPath("/photos/")).toBeNull();
    expect(photoKeyFromPath("/photos/%E0%A4%A")).toBeNull();
  });
});

describe("defaultPhotoCache", () => {
  it("is the runtime's default cache when there is one", () => {
    const cache = memoryCache();
    vi.stubGlobal("caches", { default: cache });
    expect(defaultPhotoCache()).toBe(cache);
  });

  it("is null where the Cache API has no default cache", () => {
    vi.stubGlobal("caches", {});
    expect(defaultPhotoCache()).toBeNull();
    vi.stubGlobal("caches", undefined);
    expect(defaultPhotoCache()).toBeNull();
  });
});
