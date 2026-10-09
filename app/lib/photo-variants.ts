/**
 * Size variants of stored photos.
 *
 * Every photo in R2 under `<key>` may have WebP copies at a few widths, stored under
 * `variants/w<width>/<key>.webp`. They are generated outside the Worker
 * (`scripts/generate-photo-variants.mjs`, run by the Photo variants workflow), never replace the
 * original, and are never larger than it in either dimension. A client asks for one with
 * `/photos/<key>?w=<width>`; any width is accepted and rounded up to the next variant width, and
 * until the variant exists the original is served instead.
 */

export const PHOTO_VARIANT_WIDTHS = [256, 512, 1024, 1536] as const;
export type PhotoVariantWidth = (typeof PHOTO_VARIANT_WIDTHS)[number];

export const PHOTO_VARIANT_PREFIX = "variants/";
export const PHOTO_VARIANT_CONTENT_TYPE = "image/webp";
export const PHOTO_VARIANT_QUERY_PARAMETER = "w";

const PHOTOS_PATH_PREFIX = "/photos/";
const LARGEST_VARIANT_WIDTH = PHOTO_VARIANT_WIDTHS[PHOTO_VARIANT_WIDTHS.length - 1];

/** True for keys that are themselves variants, which have no variants of their own. */
export function isPhotoVariantKey(key: string): boolean {
  return key.startsWith(PHOTO_VARIANT_PREFIX);
}

/** The R2 key of `originalKey`'s variant at `width`. */
export function photoVariantKey(originalKey: string, width: PhotoVariantWidth): string {
  return `${PHOTO_VARIANT_PREFIX}w${width}/${originalKey}.webp`;
}

/** Every variant key of `originalKey`, smallest first. */
export function photoVariantKeys(originalKey: string): string[] {
  return PHOTO_VARIANT_WIDTHS.map((width) => photoVariantKey(originalKey, width));
}

/**
 * The variant width for a requested `w` value: the smallest variant at least that wide, or the
 * largest variant for anything wider. Null when no width was asked for or the value is not a
 * positive whole number.
 */
export function photoVariantWidthFor(requested: string | null | undefined): PhotoVariantWidth | null {
  if (!requested || !/^[1-9][0-9]{0,5}$/.test(requested)) {
    return null;
  }
  const pixels = Number(requested);
  return PHOTO_VARIANT_WIDTHS.find((width) => width >= pixels) ?? LARGEST_VARIANT_WIDTH;
}

function isStoredPhotoPath(pathname: string): boolean {
  return pathname.startsWith(PHOTOS_PATH_PREFIX) && pathname.length > PHOTOS_PATH_PREFIX.length;
}

/**
 * `url` asking for the variant at `width`. Only Spoonjoy `/photos/...` URLs (relative, or absolute
 * with that path) have variants; any other URL comes back unchanged.
 */
export function photoVariantUrl(url: string, width: PhotoVariantWidth): string {
  const relative = url.startsWith("/");
  let parsed: URL;
  try {
    parsed = new URL(url, "https://spoonjoy.invalid");
  } catch {
    return url;
  }
  if (!isStoredPhotoPath(parsed.pathname) || parsed.search || parsed.hash) {
    return url;
  }
  if (isPhotoVariantKey(parsed.pathname.slice(PHOTOS_PATH_PREFIX.length))) {
    return url;
  }
  parsed.searchParams.set(PHOTO_VARIANT_QUERY_PARAMETER, String(width));
  return relative ? `${parsed.pathname}${parsed.search}` : parsed.toString();
}

/**
 * A `srcset` offering every variant of a stored photo, or undefined for URLs without variants.
 * Each descriptor is the variant's target width; a photo narrower than a variant is served at its
 * own size, which browsers handle as a slightly lower-density candidate.
 */
export function photoSrcSet(url: string | null | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  const candidates = PHOTO_VARIANT_WIDTHS.map((width) => ({ width, url: photoVariantUrl(url, width) }));
  if (candidates[0].url === url) {
    return undefined;
  }
  return candidates.map((candidate) => `${candidate.url} ${candidate.width}w`).join(", ");
}
