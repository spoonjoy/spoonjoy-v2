// Turns one recipe as the other app's server returns it (GET /api/recipes/{slug}) into a draft. It makes the same draft
// the backup reader makes of the same recipe, with the same source keys, so moving in from the server and from a backup
// of it bring each recipe once. Pure: it takes the parsed JSON and does no I/O.
import { UNTITLED_RECIPE, type IngredientDraft, type RecipeDraft, type StepDraft } from "../../../model/recipe-draft";
import { normalizeGuid } from "../../../model/source-key";

type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function list(value: unknown): Json[] {
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

/** A recipe's key: its GUID as the backup spells it, or the id as given when it isn't one. */
export function recipeKey(id: unknown): string {
  return normalizeGuid(id) ?? String(id);
}

/** The server's time in UTC with a Z; the backup's database holds the same time without it. */
function updatedAt(recipe: Json): string | null {
  return text(recipe.updatedAt ?? recipe.updateAt)?.replace(/(Z|\+00:00)$/, "") ?? null;
}

function names(value: unknown): string[] {
  return list(value).flatMap((row) => text(row.name) ?? []);
}

export function apiRecipeDraft(recipe: Json): RecipeDraft {
  const key = recipeKey(recipe.id);
  const warnings: string[] = [];
  const title = text(recipe.name);
  if (!title) warnings.push(`This recipe had no name, so it's called "${UNTITLED_RECIPE}".`);

  const lines = list(recipe.recipeIngredient);
  const ingredients: IngredientDraft[] = [];
  lines.forEach((line, position) => {
    const food = isJson(line.food) ? text(line.food.name) : null;
    const unit = isJson(line.unit) ? text(line.unit.name) ?? text(line.unit.abbreviation) : null;
    const draft: IngredientDraft = {
      sourceKey: `${key}|${normalizeGuid(line.referenceId) ?? `position:${position}`}`,
      section: text(line.title),
      quantity: positiveNumber(line.quantity),
      unit,
      food,
      note: text(line.note),
      originalText: text(line.originalText),
      plainText: food === null,
    };
    if (!draft.food && !draft.note && !draft.originalText) {
      warnings.push("An ingredient line had no text, so it was left out.");
      return;
    }
    ingredients.push(draft);
  });
  // A step links to an ingredient by the ingredient's reference, which only means something inside this recipe.
  const references = new Set(lines.flatMap((line) => normalizeGuid(line.referenceId) ?? []));

  const steps: StepDraft[] = list(recipe.recipeInstructions).flatMap((row) => {
    const stepKey = normalizeGuid(row.id);
    const stepTitle = text(row.title);
    const stepText = text(row.text) ?? stepTitle;
    if (!stepKey || !stepText) return [];
    const ingredientKeys = list(row.ingredientReferences).flatMap((link) => {
      const reference = normalizeGuid(link.referenceId);
      return reference && references.has(reference) ? [`${key}|${reference}`] : [];
    });
    return [{ sourceKey: stepKey, title: stepTitle, text: stepText, ingredientKeys }];
  });

  const servings = text(recipe.recipeYield) ?? positiveNumber(recipe.recipeServings) ?? positiveNumber(recipe.recipeYieldQuantity);
  return {
    sourceKey: key,
    ownerKey: normalizeGuid(recipe.userId),
    sourceUpdatedAt: updatedAt(recipe),
    title: title ?? UNTITLED_RECIPE,
    description: text(recipe.description),
    servings: servings === null ? null : String(servings),
    sourceUrl: text(recipe.orgURL),
    // Empty when the recipe has no photo, so the move-in never asks the server for one.
    photoPath: text(recipe.image) ? `/api/media/recipes/${encodeURIComponent(String(recipe.id))}/images/original.webp` : "",
    steps,
    ingredients,
    notes: list(recipe.notes).flatMap((row) => {
      const noteText = text(row.text);
      return noteText ? [{ title: text(row.title), text: noteText }] : [];
    }),
    tags: names(recipe.tags),
    categories: names(recipe.recipeCategory),
    tools: names(recipe.tools),
    warnings,
  };
}
