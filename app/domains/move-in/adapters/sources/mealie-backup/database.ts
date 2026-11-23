// Reads the database.json at the root of the other app's admin backup: one object from table name to
// rows, with column names as the database has them. It picks out one group (one kitchen) and turns
// its recipes into drafts. Pure: it takes the parsed JSON and does no I/O.
import { MoveInError } from "../../../model/move-in-error";
import { UNTITLED_RECIPE, type IngredientDraft, type RecipeDraft, type StepDraft } from "../../../model/recipe-draft";
import { normalizeGuid } from "../../../model/source-key";

type Row = Record<string, unknown>;

export interface MealieVersion {
  label: string;
  major: 1 | 2 | 3;
  known: boolean;
}

export interface MealieDatabase {
  version: MealieVersion;
  rows(table: string): Row[];
}

export interface MealieGroup {
  key: string;
  name: string;
  recipes: number;
  members: number;
}

// The schema revision at the head of each release the move-in proof seeds, and the first 1.x and 2.x.
// v3.0.0 has the same head as v2.8.0.
const REVISIONS: Record<string, { label: string; major: 1 | 2 | 3 }> = {
  ba1e4a6cfe99: { label: "v1.0.0", major: 1 },
  "32d69327997b": { label: "v1.12.0", major: 1 },
  "86054b40fd06": { label: "v2.0.0", major: 2 },
  "7cf3054cbbcc": { label: "v2.8.0", major: 2 },
  f3a1ae61d772: { label: "v3.31.0", major: 3 },
};

const NEWEST_KNOWN = "v3.31.0";

function isRow(value: unknown): value is Row {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function readMealieDatabase(json: unknown): MealieDatabase {
  if (!isRow(json) || !Array.isArray(json.recipes)) throw new MoveInError("not-a-backup", "database.json has no recipes table");
  const tables = json;
  const rows = (table: string): Row[] => {
    const value = tables[table];
    return Array.isArray(value) ? value.filter(isRow) : [];
  };
  const revision = text(rows("alembic_version")[0]?.version_num);
  const known = revision ? REVISIONS[revision] : undefined;
  const version: MealieVersion = known
    ? { ...known, known: true }
    : { label: `newer than ${NEWEST_KNOWN}`, major: "ai_providers" in tables ? 3 : "households" in tables ? 2 : 1, known: false };
  return { version, rows };
}

function groupRows(db: MealieDatabase, table: string, groupKey: string): Row[] {
  return db.rows(table).filter((row) => normalizeGuid(row.group_id) === groupKey);
}

export function listGroups(db: MealieDatabase): MealieGroup[] {
  return db.rows("groups").flatMap((group) => {
    const key = normalizeGuid(group.id);
    if (!key) return [];
    return [{
      key,
      name: text(group.name) ?? "Kitchen",
      recipes: groupRows(db, "recipes", key).length,
      members: groupRows(db, "users", key).length,
    }];
  });
}

/**
 * The group to bring: the only one with recipes, or the one of those whose members include the importer's email; null
 * means ask. Every backup also holds the empty group the app makes when it first starts, which is passed over.
 */
export function chooseGroup(db: MealieDatabase, importerEmail: string | null): string | null {
  const all = listGroups(db);
  const withRecipes = all.filter((group) => group.recipes > 0);
  const groups = withRecipes.length ? withRecipes : all;
  if (groups.length === 1) return groups[0].key;
  const email = importerEmail?.trim().toLowerCase();
  const user = db.rows("users").find((row) => typeof row.email === "string" && row.email.toLowerCase() === email);
  const key = normalizeGuid(user?.group_id);
  return groups.some((group) => group.key === key) ? key : null;
}

/** Everything one group's recipes hang off, indexed once. */
function groupIndex(db: MealieDatabase, groupKey: string) {
  const recipes = groupRows(db, "recipes", groupKey).filter((row) => normalizeGuid(row.id));
  const recipeKeys = new Set(recipes.map((row) => normalizeGuid(row.id) as string));
  const byRecipe = (table: string) => {
    const map = new Map<string, Row[]>();
    for (const row of db.rows(table)) {
      const key = normalizeGuid(row.recipe_id);
      if (!key || !recipeKeys.has(key)) continue;
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return map;
  };
  const named = (table: string) =>
    new Map(groupRows(db, table, groupKey).flatMap((row) => {
      const key = normalizeGuid(row.id);
      return key ? [[key, row] as const] : [];
    }));
  const steps = byRecipe("recipe_instructions");
  const stepKeys = new Set([...steps.values()].flat().map((row) => normalizeGuid(row.id)).filter(Boolean));
  const ingredients = byRecipe("recipes_ingredients");
  const references = new Set(
    [...ingredients.entries()].flatMap(([recipe, rows]) => rows.map((row) => `${recipe}|${normalizeGuid(row.reference_id) ?? "none"}`)),
  );
  const stepRecipe = new Map([...steps.entries()].flatMap(([recipe, rows]) => rows.map((row) => [normalizeGuid(row.id), recipe] as const)));
  const links = new Map<string, string[]>();
  for (const link of db.rows("recipe_ingredient_ref_link")) {
    const step = normalizeGuid(link.instruction_id);
    const recipe = stepRecipe.get(step);
    const referenceId = normalizeGuid(link.reference_id);
    const reference = `${recipe}|${referenceId}`;
    if (!step || !referenceId || !stepKeys.has(step) || !references.has(reference)) continue;
    links.set(step, [...(links.get(step) ?? []), reference]);
  }
  const joined = (table: string, column: string, names: Map<string, Row>) => {
    const map = new Map<string, string[]>();
    for (const row of db.rows(table)) {
      const recipe = normalizeGuid(row.recipe_id);
      const target = names.get(normalizeGuid(row[column]) as string);
      if (!recipe || !recipeKeys.has(recipe) || !target) continue;
      map.set(recipe, [...(map.get(recipe) ?? []), text(target.name) as string]);
    }
    return map;
  };
  const tags = named("tags");
  const categories = named("categories");
  const tools = named("tools");
  return {
    recipes,
    steps,
    ingredients,
    links,
    notes: byRecipe("notes"),
    settings: byRecipe("recipe_settings"),
    foods: named("ingredient_foods"),
    units: named("ingredient_units"),
    users: groupRows(db, "users", groupKey),
    tags,
    categories,
    tools,
    recipeTags: joined("recipes_to_tags", "tag_id", tags),
    recipeCategories: joined("recipes_to_categories", "category_id", categories),
    recipeTools: joined("recipes_to_tools", "tool_id", tools),
  };
}

function total(map: Map<string, unknown[]>): number {
  return [...map.values()].reduce((sum, rows) => sum + rows.length, 0);
}

/** What the group holds, counted the way the move-in proof's manifest counts a kitchen. */
export function inspectGroup(db: MealieDatabase, groupKey: string) {
  const index = groupIndex(db, groupKey);
  const ingredients = [...index.ingredients.values()].flat();
  const recipesByMember: Record<string, number> = {};
  for (const recipe of index.recipes) {
    const owner = normalizeGuid(recipe.user_id) ?? "unknown";
    recipesByMember[owner] = (recipesByMember[owner] ?? 0) + 1;
  }
  return {
    users: index.users.length,
    recipes: index.recipes.length,
    recipesByMember,
    recipeNotes: total(index.notes),
    ingredients: ingredients.length,
    ingredientsWithFood: ingredients.filter((row) => index.foods.has(normalizeGuid(row.food_id) as string)).length,
    ingredientsWithUnit: ingredients.filter((row) => index.units.has(normalizeGuid(row.unit_id) as string)).length,
    steps: total(index.steps),
    stepIngredientReferences: total(index.links),
    foods: index.foods.size,
    units: index.units.size,
    tags: index.tags.size,
    categories: index.categories.size,
    tools: index.tools.size,
    recipeTags: total(index.recipeTags),
    recipeCategories: total(index.recipeCategories),
    recipeTools: total(index.recipeTools),
  };
}

function byPosition(rows: Row[]): Row[] {
  const position = (row: Row) => (typeof row.position === "number" ? row.position : Number.POSITIVE_INFINITY);
  return rows.map((row, order) => ({ row, order })).sort((a, b) => position(a.row) - position(b.row) || a.order - b.order).map(({ row }) => row);
}

function servingsOf(recipe: Row): string | null {
  const servings = text(recipe.recipe_yield) ?? positiveNumber(recipe.recipe_servings) ?? positiveNumber(recipe.recipe_yield_quantity);
  return servings === null ? null : String(servings);
}

/** The group's recipes as drafts, in the order the backup lists them. */
export function recipeDrafts(db: MealieDatabase, groupKey: string): RecipeDraft[] {
  const index = groupIndex(db, groupKey);
  return index.recipes.map((recipe) => {
    const key = normalizeGuid(recipe.id) as string;
    const warnings: string[] = [];
    const title = text(recipe.name);
    if (!title) warnings.push(`This recipe had no name, so it's called "${UNTITLED_RECIPE}".`);

    const ingredients: IngredientDraft[] = [];
    for (const row of byPosition(index.ingredients.get(key) ?? [])) {
      const food = text(index.foods.get(normalizeGuid(row.food_id) as string)?.name);
      const unitRow = index.units.get(normalizeGuid(row.unit_id) as string);
      const draft: IngredientDraft = {
        sourceKey: `${key}|${normalizeGuid(row.reference_id) ?? `position:${row.position}`}`,
        section: text(row.title),
        quantity: positiveNumber(row.quantity),
        unit: unitRow ? text(unitRow.name) ?? text(unitRow.abbreviation) : null,
        food,
        note: text(row.note),
        originalText: text(row.original_text),
        plainText: food === null,
      };
      if (!draft.food && !draft.note && !draft.originalText) {
        warnings.push("An ingredient line had no text, so it was left out.");
        continue;
      }
      ingredients.push(draft);
    }

    const steps: StepDraft[] = byPosition(index.steps.get(key) ?? []).flatMap((row) => {
      const stepKey = normalizeGuid(row.id);
      const stepTitle = text(row.title);
      const stepText = text(row.text) ?? stepTitle;
      if (!stepKey || !stepText) return [];
      return [{ sourceKey: stepKey, title: stepTitle, text: stepText, ingredientKeys: index.links.get(stepKey) ?? [] }];
    });

    return {
      sourceKey: key,
      ownerKey: normalizeGuid(recipe.user_id),
      sourceUpdatedAt: text(recipe.update_at),
      title: title ?? UNTITLED_RECIPE,
      description: text(recipe.description),
      servings: servingsOf(recipe),
      sourceUrl: text(recipe.org_url),
      photoPath: `data/recipes/${key}/images/original.webp`,
      steps,
      ingredients,
      notes: (index.notes.get(key) ?? []).flatMap((row) => {
        const noteText = text(row.text);
        return noteText ? [{ title: text(row.title), text: noteText }] : [];
      }),
      tags: index.recipeTags.get(key) ?? [],
      categories: index.recipeCategories.get(key) ?? [],
      tools: index.recipeTools.get(key) ?? [],
      warnings,
    };
  });
}
