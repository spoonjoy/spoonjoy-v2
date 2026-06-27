/**
 * JSON-LD (schema.org Recipe) extractor for recipe-import.
 *
 * Pure function: no I/O. Given an HTML string, returns either a normalized
 * Recipe draft (first encountered Recipe across all script blocks and @graph
 * containers) or null. `multipleRecipes` is true iff more than one Recipe
 * block was discovered across the whole document.
 */

export interface JsonLdRecipeDraft {
  title: string;
  description: string | null;
  servings: string | null;
  ingredients: string[];
  steps: string[];
  imageUrl: string | null;
}

export interface JsonLdExtractResult {
  draft: JsonLdRecipeDraft | null;
  multipleRecipes: boolean;
  /**
   * Count of `application/ld+json` script blocks whose body failed to parse as
   * JSON. Non-zero with `draft: null` means usable structured data may have
   * existed but was malformed, and the import is about to fall through to the
   * costly LLM path — the caller surfaces this as a low-severity signal.
   */
  malformedBlocks: number;
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [k: string]: JsonValue }
  | JsonValue[];

const SCRIPT_REGEX =
  /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi;

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeMatchesRecipe(node: Record<string, JsonValue>): boolean {
  const t = node["@type"];
  if (typeof t === "string") return t === "Recipe";
  if (Array.isArray(t)) return t.some((x) => x === "Recipe");
  return false;
}

function collectRecipes(node: JsonValue, into: Record<string, JsonValue>[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectRecipes(item, into);
    return;
  }
  if (!isRecord(node)) return;
  if (typeMatchesRecipe(node)) {
    into.push(node);
  }
  const graph = node["@graph"];
  if (graph !== undefined) {
    collectRecipes(graph, into);
  }
}

function asNullableString(value: JsonValue | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}

function extractIngredients(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") result.push(entry);
  }
  return result;
}

function extractStepText(node: JsonValue): string | null {
  if (!isRecord(node)) return null;
  const text = node.text;
  if (typeof text === "string" && text.trim().length > 0) return text;
  return null;
}

function extractSteps(value: JsonValue | undefined): string[] {
  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const type = entry["@type"];
    if (type === "HowToSection") {
      const list = entry.itemListElement;
      if (Array.isArray(list)) {
        for (const sub of list) {
          const text = extractStepText(sub);
          if (text) result.push(text);
        }
      }
      continue;
    }
    const text = extractStepText(entry);
    if (text) result.push(text);
  }
  return result;
}

function extractImage(value: JsonValue | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return extractImage(value[0]);
  }
  if (isRecord(value)) {
    const url = value.url;
    if (typeof url === "string") return url;
  }
  return null;
}

function normalizeRecipe(node: Record<string, JsonValue>): JsonLdRecipeDraft | null {
  const rawTitle = node.name;
  if (typeof rawTitle !== "string") return null;
  const title = rawTitle.trim();
  if (!title) return null;
  const description = asNullableString(node.description);
  const servings = asNullableString(node.recipeYield);
  const ingredients = extractIngredients(node.recipeIngredient);
  const steps = extractSteps(node.recipeInstructions);
  const imageUrl = extractImage(node.image);
  return {
    title,
    description,
    servings,
    ingredients,
    steps,
    imageUrl,
  };
}

export function extractRecipeJsonLd(html: string): JsonLdExtractResult {
  const candidates: Record<string, JsonValue>[] = [];
  let malformedBlocks = 0;
  let match: RegExpExecArray | null;
  SCRIPT_REGEX.lastIndex = 0;
  while ((match = SCRIPT_REGEX.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    let parsed: JsonValue;
    try {
      parsed = JSON.parse(raw) as JsonValue;
    } catch {
      // A present-but-unparseable ld+json block. Count it so the orchestrator
      // can tell "no structured data" apart from "structured data, but broken"
      // before it spends an LLM call.
      malformedBlocks += 1;
      continue;
    }
    collectRecipes(parsed, candidates);
  }
  if (candidates.length === 0) {
    return { draft: null, multipleRecipes: false, malformedBlocks };
  }
  for (const candidate of candidates) {
    const draft = normalizeRecipe(candidate);
    if (draft) {
      return {
        draft,
        multipleRecipes: candidates.length > 1,
        malformedBlocks,
      };
    }
  }
  return { draft: null, multipleRecipes: candidates.length > 1, malformedBlocks };
}
