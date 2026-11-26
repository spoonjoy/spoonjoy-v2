// Turns one recipe from another Spoonjoy's account export (GET /api/v1/me/export, app/lib/account-export.server.ts)
// into a draft. Spoonjoy keeps each ingredient on the step that uses it, so each step's ingredients come over linked
// to that step, and each step keeps its time. A recipe that moved out of this Spoonjoy and is now moving back is
// tied to the recipe it started as here (`home`), so a kitchen moved out and back comes back without copies. Pure: it
// takes the parsed JSON and does no I/O.
import { UNTITLED_RECIPE, type IngredientDraft, type RecipeDraft, type StepDraft } from "../../../model/recipe-draft";

type Json = Record<string, unknown>;

/** The kind a move-in from another Spoonjoy records its source as (SPOONJOY_SOURCE_KIND in source.ts). */
export const SPOONJOY_KIND = "spoonjoy";

function isJson(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isJson) : [];
}

export function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** The names in a list of strings, without blanks. */
export function names(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((name) => text(name) ?? []) : [];
}

/**
 * Where the recipe's photo is on its server: the path of its active cover's photo, or "" when it has none there. Only
 * a photo the server itself keeps (under /photos/) is asked for, at the address the cook gave, so the token never
 * goes anywhere else, whichever address the export names it at.
 */
export function photoPathOf(recipe: Json): string {
  const cover = list(recipe.covers).find((row) => row.active === true);
  const url = cover ? (text(cover.imageUrl) ?? text(cover.stylizedImageUrl)) : null;
  if (!url) return "";
  let path: URL;
  try {
    path = new URL(url, "https://spoonjoy.invalid");
  } catch {
    return "";
  }
  return path.pathname.startsWith("/photos/") ? `${path.pathname}${path.search}` : "";
}

/** An address as a move-in keeps a server's: its origin and path, without a trailing slash. */
export function sameAddress(a: string, b: string): boolean {
  const key = (address: string) => {
    try {
      const url = new URL(address.trim());
      return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    } catch {
      return null;
    }
  };
  const left = key(a);
  return left !== null && left === key(b);
}

/**
 * The recipe in this Spoonjoy that the other Spoonjoy's recipe moved in from, if it did: a move-in from a Spoonjoy at
 * `home`, this one's own address, brought it there. Null when it started anywhere else, or `home` isn't known.
 */
export function homeOf(recipe: Json, home: string | null): RecipeDraft["home"] {
  if (!home) return null;
  const origin = list(recipe.movedInFrom).find((row) => row.kind === SPOONJOY_KIND && typeof row.serverUrl === "string" && sameAddress(row.serverUrl, home) && text(row.sourceKey));
  return origin ? { recipeId: text(origin.sourceKey) as string, contentHash: text(origin.contentHash) } : null;
}

export function spoonjoyRecipeDraft(recipe: Json, ownerKey: string, home: string | null = null): RecipeDraft {
  const key = String(recipe.id);
  const warnings: string[] = [];
  const title = text(recipe.title);
  if (!title) warnings.push(`This recipe had no name, so it's called "${UNTITLED_RECIPE}".`);

  const cameFrom = homeOf(recipe, home);
  const ingredients: IngredientDraft[] = [];
  // Each kept step's number in the draft, by its number in the export, so a step's links follow the steps kept.
  const numbered = new Map<unknown, number>();
  const steps: StepDraft[] = list(recipe.steps).flatMap((row, position) => {
    const stepText = text(row.description);
    if (!stepText) return [];
    const own = numbered.size + 1;
    if (typeof row.stepNum === "number") numbered.set(row.stepNum, own);
    const usesOutputOf = [...new Set((Array.isArray(row.usesOutputOfSteps) ? row.usesOutputOfSteps : []).flatMap((stepNum) => numbered.get(stepNum) ?? []))]
      .filter((used) => used < own)
      .sort((a, b) => a - b);
    // A step is named by its number in the recipe, which is how the export names it.
    const stepKey = `${key}|step:${typeof row.stepNum === "number" ? row.stepNum : `position:${position}`}`;
    const ingredientKeys = list(row.ingredients).flatMap((line, index) => {
      const food = text(line.name);
      if (!food) return [];
      const sourceKey = `${stepKey}|${index}`;
      ingredients.push({
        sourceKey,
        section: null,
        quantity: positiveNumber(line.quantity),
        unit: text(line.unit),
        food,
        note: null,
        originalText: null,
        plainText: false,
      });
      return [sourceKey];
    });
    return [{ sourceKey: stepKey, title: text(row.title), text: stepText, ingredientKeys, duration: positiveNumber(row.durationMinutes), usesOutputOf }];
  });

  return {
    sourceKey: key,
    ownerKey,
    sourceUpdatedAt: text(recipe.updatedAt),
    title: title ?? UNTITLED_RECIPE,
    description: text(recipe.description),
    servings: text(recipe.servings),
    sourceUrl: text(recipe.sourceUrl),
    photoPath: photoPathOf(recipe),
    steps,
    ingredients,
    notes: [],
    tags: names(recipe.tags),
    categories: names(recipe.categories),
    tools: names(recipe.tools),
    warnings,
    home: cameFrom,
  };
}
