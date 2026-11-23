// Nutrition: what a recipe's ingredients add up to, from USDA FoodData Central's SR Legacy foods (CC0).
//
// An ingredient is matched to a food by its name as a recipe writes it, ignoring case, a plural "s", anything after a
// comma ("onion, diced") and a word cooks put in front that doesn't change the food (large, fresh, chopped). It is
// weighed from its amount: a weight as it is, a volume by what a cup of that food weighs, and a counted food ("2
// cloves", "1 onion") by what one weighs. What can't be matched or weighed is left out and counted, so a reader sees
// how much of the recipe the figures cover.
import { FOOD_NUTRITION, type FoodNutrition } from "../data/nutrition.generated";
import { resolveUnit } from "./units";

export type { FoodNutrition };

/** Calories (kcal) and grams of protein, fat, carbohydrate and fiber. */
export interface NutritionFacts {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
}

/** The FDC credit to show beside any figure built from this data. */
export const NUTRITION_SOURCE = "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central.";

const US_CUP_ML = 236.5882365;

// Words a cook writes before a food that don't change what it is.
const LEADING_WORDS = new Set([
  "large", "medium", "small", "extra-large", "fresh", "freshly", "ripe", "raw", "cold", "warm", "softened", "melted",
  "chopped", "minced", "diced", "sliced", "grated", "shredded", "finely", "roughly", "packed", "organic",
]);

// Units that count a food one at a time, so they weigh what one of it does.
const COUNTED_UNITS = new Set(["clove", "whole", "piece", "each", "item", "breast", "thigh", "fillet", "stalk", "slice", "medium", "large", "small"]);

function singular(word: string): string {
  return word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

function words(name: string): string[] {
  return (name.split(",")[0] as string).toLowerCase().trim().split(/\s+/).filter(Boolean).map(singular);
}

const FOODS_BY_NAME = new Map(FOOD_NUTRITION.flatMap((food) => food.names.map((name) => [words(name).join(" "), food] as const)));

/** The food a recipe's ingredient name reads as, or null when Spoonjoy has no nutrition for it. */
export function foodNutritionFor(name: string | null | undefined): FoodNutrition | null {
  const parts = words(name ?? "");
  for (;;) {
    const food = FOODS_BY_NAME.get(parts.join(" "));
    if (food) return food;
    if (parts.length < 2 || !LEADING_WORDS.has(parts[0] as string)) return null;
    parts.shift();
  }
}

/** What an amount of a food weighs in grams, or null when it can't be weighed (no number, or no weight to go by). */
export function gramsOf(food: FoodNutrition, quantity: number | string | null | undefined, unit: string | null | undefined): number | null {
  const amount = typeof quantity === "string" ? Number.parseFloat(quantity) : quantity;
  if (amount == null || !Number.isFinite(amount)) return null;
  const known = resolveUnit(unit);
  if (known?.dimension === "mass") return amount * known.toBase;
  if (known) return food.gramsPerCup ? ((amount * known.toBase) / US_CUP_ML) * food.gramsPerCup : null;
  const counted = !unit?.trim() || COUNTED_UNITS.has(singular(unit.trim().toLowerCase()));
  return counted && food.gramsEach ? amount * food.gramsEach : null;
}

export interface RecipeNutrition {
  total: NutritionFacts;
  /** The total over the recipe's servings; null when it doesn't say how many it serves. */
  perServing: NutritionFacts | null;
  /** How many ingredients the figures include, of how many the recipe has. */
  weighed: number;
  of: number;
}

const NONE: NutritionFacts = { kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 };
const KEYS = Object.keys(NONE) as (keyof NutritionFacts)[];

/** What a recipe's ingredients add up to, in all and per serving. */
export function recipeNutrition(
  ingredients: readonly { name: string; quantity: number | string | null | undefined; unit: string | null | undefined }[],
  servings: number | null | undefined,
): RecipeNutrition {
  const total = { ...NONE };
  let weighed = 0;
  for (const ingredient of ingredients) {
    const food = foodNutritionFor(ingredient.name);
    const grams = food && gramsOf(food, ingredient.quantity, ingredient.unit);
    if (!food || grams == null) continue;
    weighed += 1;
    for (const key of KEYS) total[key] += (food.per100g[key] * grams) / 100;
  }
  const perServing = servings && servings > 0 ? Object.fromEntries(KEYS.map((key) => [key, total[key] / servings])) as unknown as NutritionFacts : null;
  return { total, perServing, weighed, of: ingredients.length };
}

/** Grams as a nutrition label writes them: to a tenth below 10 g ("6.8 g"), whole from there ("75 g"). */
export function formatGrams(grams: number): string {
  return grams < 10 ? `${Math.round(grams * 10) / 10} g` : `${Math.round(grams)} g`;
}
