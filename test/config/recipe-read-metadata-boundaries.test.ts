import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { API_V1_PLAYGROUND_MANIFEST } from "~/lib/generated/api-v1-playground";

const root = resolve(__dirname, "..", "..");
const BASE_RECIPE_SUMMARY_KEYS = [
  "attribution", "canonicalUrl", "chef", "coverImageUrl", "coverProvenanceLabel", "coverSourceType",
  "coverVariant", "createdAt", "description", "href", "id", "servings", "title", "updatedAt",
] as const;
const BASE_RECIPE_DETAIL_KEYS = [...BASE_RECIPE_SUMMARY_KEYS, "cookbooks", "steps"] as const;
const DELETED_RECIPE_KEYS = ["deletedAt", "id", "updatedAt"] as const;

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function operation(id: string) {
  const match = API_V1_PLAYGROUND_MANIFEST.operations.find((candidate) => candidate.id === id);
  expect(match, id).toBeDefined();
  return match!;
}

function responseExample(id: string, status = "200") {
  const match = operation(id).responseExamples.find((candidate) => candidate.status === status);
  expect(match, `${id} ${status}`).toBeDefined();
  return JSON.parse(match!.example) as Record<string, any>;
}

describe("neutral recipe metadata boundaries", () => {
  it("keeps all legacy import guides explicit about agent-only import and no first-party UI", () => {
    const guides = [
      "docs/api.md",
      "app/routes/developers.tsx",
      "docs/claude-connector.md",
    ];

    for (const guide of guides) {
      const content = source(guide);
      expect(content, guide).toContain("import_recipe_from_url");
      expect(content, guide).toMatch(/not an MCP tool/i);
      expect(content, guide).toMatch(/no first-party import UI/i);
    }
  });

  it.each(["docs/api.md", "app/routes/developers.tsx"])(
    "documents neutral course and tags without save state in %s",
    (guide) => {
      const content = source(guide);
      expect(content, guide).toMatch(/recipe reads[^\n]*(?:course[^\n]*tags|tags[^\n]*course)/i);
      expect(content, guide).toMatch(/(?:no|without)[^\n]*(?:personalized|isSaved|save state)/i);
    },
  );

  it("keeps the generated recipe-list example metadata-aware and neutral", () => {
    const listRecipe = responseExample("GET /api/v1/recipes").data.recipes[0];
    expect(listRecipe).toMatchObject({ course: "main", tags: ["Weeknight"] });
    expect(listRecipe).not.toHaveProperty("isSaved");
  });

  it("keeps the generated recipe-detail example metadata-aware and neutral", () => {
    const detailRecipe = responseExample("GET /api/v1/recipes/{id}").data.recipe;
    expect(detailRecipe).toMatchObject({ course: "main", tags: ["Weeknight"] });
    expect(detailRecipe).not.toHaveProperty("isSaved");
  });

  it("adds neutral metadata to the generated generic-search recipe result", () => {
    const results = responseExample("GET /api/v1/search").data.results as Array<Record<string, any>>;
    const recipe = results.find((result) => result.type === "recipe");

    expect(recipe?.metadata).toMatchObject({ course: "main", tags: ["Weeknight"] });
    expect(recipe?.metadata).not.toHaveProperty("isSaved");
  });

  it("keeps generated generic-search non-recipe metadata byte-compatible", () => {
    const results = responseExample("GET /api/v1/search").data.results as Array<Record<string, any>>;
    const byType = new Map(results.map((result) => [result.type, result]));

    expect([...byType.keys()].sort()).toEqual(["chef", "cookbook", "recipe", "shopping-list-item"]);
    const expected = new Map<string, Record<string, unknown>>([
      ["cookbook", { authorUsername: "ari", recipeCount: 1, recipeTitles: ["Pasta"] }],
      ["chef", { username: "ari", recipeCount: 1, cookbookCount: 1 }],
      ["shopping-list-item", {
        quantity: 12,
        unit: "each",
        checked: false,
        categoryKey: null,
        iconKey: null,
        sortIndex: 0,
      }],
    ]);
    for (const [type, metadata] of expected) {
      expect(byType.get(type)?.metadata, type).toEqual(metadata);
    }
  });

  it("keeps every generated mutation, recovery, native, import, and cookbook recipe shape exact", () => {
    const detail = (payload: Record<string, any>) => payload.data.recipe ? [payload.data.recipe] : [];
    const cookbook = (payload: Record<string, any>) => payload.data.cookbook.recipes;
    const consumers: Array<{
      id: string;
      keys: readonly string[];
      select: (payload: Record<string, any>) => Array<Record<string, any>>;
    }> = [
      { id: "POST /api/v1/recipes", keys: BASE_RECIPE_DETAIL_KEYS, select: detail },
      { id: "PATCH /api/v1/recipes/{id}", keys: BASE_RECIPE_DETAIL_KEYS, select: detail },
      { id: "DELETE /api/v1/recipes/{id}", keys: DELETED_RECIPE_KEYS, select: detail },
      { id: "POST /api/v1/recipes/{id}/fork", keys: BASE_RECIPE_DETAIL_KEYS, select: detail },
      { id: "POST /api/v1/recipes/import", keys: BASE_RECIPE_DETAIL_KEYS, select: detail },
      { id: "POST /api/v1/recipes/{id}/steps", keys: BASE_RECIPE_DETAIL_KEYS, select: detail },
      { id: "PATCH /api/v1/recipes/{id}/steps/{stepId}", keys: BASE_RECIPE_DETAIL_KEYS, select: detail },
      { id: "DELETE /api/v1/recipes/{id}/steps/{stepId}", keys: BASE_RECIPE_DETAIL_KEYS, select: detail },
      { id: "POST /api/v1/recipes/{id}/steps/reorder", keys: BASE_RECIPE_DETAIL_KEYS, select: detail },
      { id: "POST /api/v1/recipes/{id}/steps/{stepId}/ingredients", keys: BASE_RECIPE_DETAIL_KEYS, select: detail },
      { id: "DELETE /api/v1/recipes/{id}/steps/{stepId}/ingredients/{ingredientId}", keys: BASE_RECIPE_DETAIL_KEYS, select: detail },
      { id: "PUT /api/v1/recipes/{id}/step-output-uses", keys: BASE_RECIPE_DETAIL_KEYS, select: detail },
      {
        id: "GET /api/v1/me/sync",
        keys: BASE_RECIPE_DETAIL_KEYS,
        select: (payload) => payload.data.entries
          .filter((entry: Record<string, any>) => entry.kind === "recipe" && entry.payload)
          .map((entry: Record<string, any>) => entry.payload),
      },
      { id: "GET /api/v1/cookbooks/{id}", keys: BASE_RECIPE_SUMMARY_KEYS, select: cookbook },
      { id: "POST /api/v1/cookbooks/{id}/recipes/{recipeId}", keys: BASE_RECIPE_SUMMARY_KEYS, select: cookbook },
      { id: "DELETE /api/v1/cookbooks/{id}/recipes/{recipeId}", keys: BASE_RECIPE_SUMMARY_KEYS, select: cookbook },
    ];

    for (const consumer of consumers) {
      for (const candidate of operation(consumer.id).responseExamples) {
        if (!candidate.status.startsWith("2")) continue;
        const payload = JSON.parse(candidate.example) as Record<string, any>;
        const serialized = JSON.stringify(payload);
        const recipes = consumer.select(payload);
        expect(recipes.length, `${consumer.id} ${candidate.status}`).toBeGreaterThan(0);
        for (const recipe of recipes) {
          expect(Object.keys(recipe).sort(), `${consumer.id} ${candidate.status}`).toEqual([...consumer.keys].sort());
        }
        expect(serialized, `${consumer.id} ${candidate.status}`).not.toMatch(/"(?:course|tags|isSaved)":/);
      }
    }
  });
});
