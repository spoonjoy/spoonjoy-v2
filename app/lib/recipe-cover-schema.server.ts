export const RECIPE_COVER_SOURCE_TYPES = ["ai-placeholder", "import", "chef-upload", "spoon"] as const;
export const RECIPE_COVER_VARIANTS = ["image", "stylized"] as const;
export const RECIPE_COVER_MODES = ["auto", "manual", "none"] as const;
export const RECIPE_COVER_STATUSES = ["processing", "ready", "failed", "archived"] as const;
export const RECIPE_COVER_GENERATION_STATUSES = ["none", "processing", "succeeded", "failed"] as const;

export type RecipeCoverSourceType = (typeof RECIPE_COVER_SOURCE_TYPES)[number];
export type RecipeCoverVariant = (typeof RECIPE_COVER_VARIANTS)[number];
export type RecipeCoverMode = (typeof RECIPE_COVER_MODES)[number];
export type RecipeCoverStatus = (typeof RECIPE_COVER_STATUSES)[number];
export type RecipeCoverGenerationStatus = (typeof RECIPE_COVER_GENERATION_STATUSES)[number];

function isOneOf<T extends string>(
  value: string | null | undefined,
  options: readonly T[],
): value is T {
  return options.includes(value as T);
}

export function normalizeRecipeCoverVariant(value: string | null | undefined): RecipeCoverVariant | null {
  return isOneOf(value, RECIPE_COVER_VARIANTS) ? value : null;
}

export function normalizeRecipeCoverMode(value: string | null | undefined): RecipeCoverMode | null {
  if (value == null) return "auto";
  return isOneOf(value, RECIPE_COVER_MODES) ? value : null;
}

export function normalizeRecipeCoverStatus(value: string | null | undefined): RecipeCoverStatus | null {
  return isOneOf(value, RECIPE_COVER_STATUSES) ? value : null;
}

export function assertRecipeCoverSourceType(sourceType: string): asserts sourceType is RecipeCoverSourceType {
  if (!isOneOf(sourceType, RECIPE_COVER_SOURCE_TYPES)) {
    throw new Error("Invalid cover source type");
  }
}

export function assertRecipeCoverStatus(status: string): asserts status is RecipeCoverStatus {
  if (!isOneOf(status, RECIPE_COVER_STATUSES)) {
    throw new Error("Invalid cover status");
  }
}

export function assertRecipeCoverGenerationStatus(status: string): asserts status is RecipeCoverGenerationStatus {
  if (!isOneOf(status, RECIPE_COVER_GENERATION_STATUSES)) {
    throw new Error("Invalid cover generation status");
  }
}

export function assertRecipeCoverVariant(variant: string): asserts variant is RecipeCoverVariant {
  if (!isOneOf(variant, RECIPE_COVER_VARIANTS)) {
    throw new Error("Invalid cover variant");
  }
}
