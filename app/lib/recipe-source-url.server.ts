// The one form a recipe's source link is stored and compared in.
//
// Import checks whether the chef already has a recipe from the same link (Recipe.sourceUrl), and
// that check compares strings exactly. The writers used to store different strings for the same
// link: one stored `new URL(url).toString()` (host lowercased, a bare host given a trailing
// slash, characters percent-encoded), another stored the text as sent, spaces included. So the
// same link imported two ways made two recipes. Every writer and every lookup now goes through
// normalizeRecipeSourceUrl.
//
// Besides URL's own normalization, it drops the fragment and the common click-tracking
// parameters (utm_*, fbclid, gclid, mc_cid, mc_eid), which never change which recipe a page is.
// Any other query parameter is kept, because some recipe sites identify the recipe by one
// (?recipe=123). Text that is not an http(s) URL is kept as given, trimmed: it is the chef's own
// provenance note, and there is nothing to normalize.

const TRACKING_PARAMETER = /^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i;

export function normalizeRecipeSourceUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!URL.canParse(trimmed)) return trimmed;
  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") return trimmed;
  url.hash = "";
  for (const name of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMETER.test(name)) url.searchParams.delete(name);
  }
  return url.toString();
}

/**
 * The stored values a lookup should match: the normalized link, and the text as given, which
 * finds a recipe stored before links were normalized.
 */
export function recipeSourceUrlCandidates(value: string | null | undefined): string[] {
  const normalized = normalizeRecipeSourceUrl(value);
  if (!normalized) return [];
  return [...new Set([normalized, value!.trim(), value!])];
}
