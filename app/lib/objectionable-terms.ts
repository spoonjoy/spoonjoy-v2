/**
 * Spoonjoy's objectionable-content filter (App Store guideline 1.2), checked when recipes,
 * steps, cookbooks and cook logs are written. A short list we maintain: slurs and explicit sexual
 * terms that never belong in a recipe. Matching is whole-word and case-insensitive, with common
 * letter-for-symbol swaps undone, so cooking words that merely contain a term ("cocktail",
 * "Scunthorpe") pass. Add a term here, with a test, when a report shows one got through.
 * Cooking terms with another meaning ("retard" a dough, "faggot" meatballs in British cookery)
 * are deliberately left out; reports and blocking cover those.
 */
export const OBJECTIONABLE_TERMS: readonly string[] = [
  // Slurs
  "nigger", "nigga", "kike", "spic", "chink", "gook", "wetback", "raghead", "towelhead", "tranny", "fag",
  // Explicit sexual content
  "porn", "porno", "pornography", "blowjob", "handjob", "rimjob", "cumshot", "gangbang", "bukkake", "dildo", "hentai",
  // Hate phrases
  "heil hitler", "white power", "kkk",
];

export const OBJECTIONABLE_CONTENT_MESSAGE =
  "Please remove language that breaks Spoonjoy's community rules (spoonjoy.app/terms).";

const SWAPS: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const TERMS_PATTERN = new RegExp(
  `(?:^|[^a-z])(?:${OBJECTIONABLE_TERMS.map((term) => escapeRegExp(term).replace(/ /g, "[^a-z]+")).join("|")})s?(?=$|[^a-z])`,
);

/**
 * True when the text contains a term from OBJECTIONABLE_TERMS as a whole word, or its plural with
 * "s". Only "s": "es" would also match ordinary words ("spices").
 */
export function containsObjectionableContent(text: string | null | undefined): boolean {
  if (!text) return false;
  const normalized = text.toLowerCase().replace(/[013457@$]/g, (character) => SWAPS[character]);
  return TERMS_PATTERN.test(normalized);
}

/** A write carried a term from OBJECTIONABLE_TERMS. */
export class ObjectionableContentError extends Error {
  constructor() {
    super(OBJECTIONABLE_CONTENT_MESSAGE);
    this.name = "ObjectionableContentError";
  }
}

/** Throws ObjectionableContentError when any of the texts contains an objectionable term. */
export function assertAcceptableText(...texts: Array<string | null | undefined>): void {
  if (texts.some((text) => containsObjectionableContent(text))) throw new ObjectionableContentError();
}
