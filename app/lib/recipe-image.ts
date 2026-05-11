/**
 * The v1 Cloudinary stock image URL that represented "no cover image". Backfilled
 * Recipes that pointed at this token are skipped during the S1 migration so the
 * AI placeholder pipeline can re-generate a real cover for them on first read.
 */
export const LEGACY_DEFAULT_RECIPE_IMAGE_TOKEN = "clbe7wr180009tkhggghtl1qd.png";
