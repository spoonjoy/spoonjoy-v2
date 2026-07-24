export const MAX_RECIPE_TAG_CODE_POINTS = 40;
export const MAX_RECIPE_TAGS = 10;

const UNICODE_WHITESPACE = /\p{White_Space}+/gu;

export function collapseRecipeTagWhitespace(value: string): string {
  return value.replace(UNICODE_WHITESPACE, " ").replace(/^ | $/g, "");
}

export function normalizeRecipeTagLabel(value: string): string {
  return collapseRecipeTagWhitespace(value.normalize("NFKC"));
}

export function normalizeRecipeTagIdentity(value: string): string {
  return normalizeRecipeTagLabel(value).toLowerCase();
}
