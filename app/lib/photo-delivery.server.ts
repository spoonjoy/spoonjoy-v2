import {
  isPhotoVariantKey,
  PHOTO_VARIANT_CONTENT_TYPE,
  PHOTO_VARIANT_QUERY_PARAMETER,
  photoVariantKey,
  photoVariantWidthFor,
  type PhotoVariantWidth,
} from "~/lib/photo-variants";

/** Originals and variants never change once written: their keys are unique per upload. */
export const PHOTO_IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
/**
 * A variant that is not generated yet is answered with the original, which may be replaced by the
 * real variant within the hour, so that answer is only cached briefly.
 */
export const PHOTO_FALLBACK_CACHE_CONTROL = "public, max-age=300";
/**
 * How long the edge keeps a photo. Shorter than the browser lifetime so that a deleted photo
 * leaves every Cloudflare location within a day.
 */
export const PHOTO_EDGE_CACHE_CONTROL = "public, max-age=86400";

export const PHOTO_CACHE_HEADER = "X-Spoonjoy-Photo-Cache";
export const PHOTO_VARIANT_HEADER = "X-Spoonjoy-Photo-Variant";

export interface PhotoDeliveryOptions {
  request: Request;
  key: string;
  bucket: R2Bucket;
  /** The edge cache; absent where the Cache API is not available (tests, local tools). */
  cache?: Cache | null;
  waitUntil?: (promise: Promise<unknown>) => void;
}

/** The R2 key in a `/photos/<key>` path, or null for any other path or an undecodable one. */
export function photoKeyFromPath(pathname: string): string | null {
  if (!pathname.startsWith("/photos/")) {
    return null;
  }
  try {
    return decodeURIComponent(pathname.slice("/photos/".length)) || null;
  } catch {
    return null;
  }
}

/** The edge cache for photos, when this runtime has one. */
export function defaultPhotoCache(): Cache | null {
  const storage = (globalThis as { caches?: CacheStorage & { default?: Cache } }).caches;
  return storage?.default ?? null;
}

function cacheKeyFor(request: Request, key: string, width: PhotoVariantWidth | null): Request {
  const url = new URL(request.url);
  const search = width ? `?${PHOTO_VARIANT_QUERY_PARAMETER}=${width}` : "";
  return new Request(`${url.origin}/photos/${key}${search}`, { method: "GET" });
}

function etagMatches(ifNoneMatch: string | null, etag: string | null): boolean {
  if (!ifNoneMatch || !etag) {
    return false;
  }
  const bare = (value: string) => value.trim().replace(/^W\//, "");
  return ifNoneMatch.split(",").some((candidate) => candidate.trim() === "*" || bare(candidate) === bare(etag));
}

function notModified(headers: Headers): Response {
  const kept = new Headers();
  for (const name of ["Cache-Control", "ETag", PHOTO_CACHE_HEADER, PHOTO_VARIANT_HEADER]) {
    // forClient sets all four on every photo response.
    kept.set(name, headers.get(name)!);
  }
  return new Response(null, { status: 304, headers: kept });
}

/**
 * What the client sees. The edge keeps every photo for a day; the client keeps a photo for a year,
 * or for five minutes when it is the original standing in for a variant that does not exist yet.
 */
function forClient(response: Response, cacheState: "hit" | "miss", isHead: boolean, isFallback: boolean): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", isFallback ? PHOTO_FALLBACK_CACHE_CONTROL : PHOTO_IMMUTABLE_CACHE_CONTROL);
  headers.set(PHOTO_CACHE_HEADER, cacheState);
  return new Response(isHead ? null : response.body, { status: response.status, headers });
}

interface StoredPhoto {
  object: R2ObjectBody;
  variant: PhotoVariantWidth | null;
}

async function readStoredPhoto(bucket: R2Bucket, key: string, width: PhotoVariantWidth | null): Promise<StoredPhoto | null> {
  if (width) {
    const variant = await bucket.get(photoVariantKey(key, width));
    if (variant) {
      return { object: variant, variant: width };
    }
  }
  const original = await bucket.get(key);
  return original ? { object: original, variant: null } : null;
}

/**
 * Serves a stored photo, or the variant `?w=` asks for, from the edge cache when it can and from R2
 * otherwise, with an ETag so clients can revalidate. Answers 404 for a missing photo.
 */
export async function deliverPhoto({ request, key, bucket, cache, waitUntil }: PhotoDeliveryOptions): Promise<Response> {
  const requestUrl = new URL(request.url);
  const width = isPhotoVariantKey(key) ? null : photoVariantWidthFor(requestUrl.searchParams.get(PHOTO_VARIANT_QUERY_PARAMETER));
  const isHead = request.method === "HEAD";
  const ifNoneMatch = request.headers.get("If-None-Match");
  const cacheKey = cacheKeyFor(request, key, width);

  const cached = cache ? await cache.match(cacheKey) : undefined;
  if (cached) {
    const isFallback = width !== null && cached.headers.get(PHOTO_VARIANT_HEADER) === "original";
    const response = forClient(cached, "hit", isHead, isFallback);
    return etagMatches(ifNoneMatch, response.headers.get("ETag")) ? notModified(response.headers) : response;
  }

  const stored = await readStoredPhoto(bucket, key, width);
  if (!stored) {
    return new Response("Photo not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const { object, variant } = stored;
  const isFallback = width !== null && variant === null;
  const headers = new Headers();
  headers.set(
    "Content-Type",
    variant ? PHOTO_VARIANT_CONTENT_TYPE : object.httpMetadata?.contentType || "image/jpeg",
  );
  headers.set("Content-Length", String(object.size));
  headers.set("ETag", object.httpEtag);
  headers.set(PHOTO_VARIANT_HEADER, variant ? `w${variant}` : "original");
  headers.set("Cache-Control", isFallback ? PHOTO_FALLBACK_CACHE_CONTROL : PHOTO_EDGE_CACHE_CONTROL);

  const edgeResponse = new Response(object.body, { status: 200, headers });
  if (cache) {
    const toCache = edgeResponse.clone();
    // A photo the edge could not keep is still served; the next request reads R2 again.
    const put = cache.put(cacheKey, toCache).catch(() => undefined);
    if (waitUntil) {
      waitUntil(put);
    } else {
      await put;
    }
  }

  const response = forClient(edgeResponse, "miss", isHead, isFallback);
  return etagMatches(ifNoneMatch, object.httpEtag) ? notModified(response.headers) : response;
}
