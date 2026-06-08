/**
 * The v1 Cloudinary stock image URL that represented "no cover image". Backfilled
 * Recipes that pointed at this token are skipped during the S1 migration so the
 * AI placeholder pipeline can re-generate a real cover for them on first read.
 */
export const LEGACY_DEFAULT_RECIPE_IMAGE_TOKEN = "clbe7wr180009tkhggghtl1qd.png";

export const IMAGE_MAX_FILE_SIZE = 5 * 1024 * 1024;

export const FOOD_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const FOOD_IMAGE_ACCEPT = FOOD_IMAGE_TYPES.join(",");
export const FOOD_IMAGE_TYPE_MESSAGE = "Photos must be JPG, PNG, or WebP.";
export const FOOD_IMAGE_SIZE_MESSAGE = "Photos must be 5 MB or smaller.";
export const RECIPE_IMAGE_TYPE_MESSAGE = "Image must be JPG, PNG, or WebP.";
export const RECIPE_IMAGE_SIZE_MESSAGE = "Image must be less than 5MB";

export const PROFILE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
export const PROFILE_IMAGE_ACCEPT = PROFILE_IMAGE_TYPES.join(",");
