import type { Recipe, RecipeCover, RecipeInCookbook } from "@prisma/client";
import { groupRows, type D1Query, type D1Row } from "~/lib/d1-read.server";
import {
  mapModel,
  RECIPE_COVER_COLUMNS,
  RECIPE_IN_COOKBOOK_COLUMNS,
  selectColumns,
  type ColumnSpec,
} from "~/lib/d1-models.server";

// A cookbook card previews its newest recipes that are not deleted. The kitchen home and
// the cookbooks page read the previews for many cookbooks in one statement: a window
// function keeps the newest four per cookbook in SQL instead of reading every entry.

export const COOKBOOK_PREVIEW_RECIPES = 4;

type PreviewRecipe = Pick<Recipe, "id" | "title" | "activeCoverId" | "activeCoverVariant" | "coverMode"> & {
  covers: RecipeCover[];
};

export type CookbookPreviewEntry = RecipeInCookbook & { recipe: PreviewRecipe };

const PREVIEW_RECIPE_COLUMNS: ColumnSpec<Omit<PreviewRecipe, "covers">> = {
  id: "string",
  title: "string",
  activeCoverId: "string?",
  activeCoverVariant: "string?",
  coverMode: "string",
};

/**
 * The newest four entries (newest `createdAt` first, then highest id) of each cookbook
 * whose id `cookbookIdsSql` selects, skipping deleted recipes, with each entry's recipe
 * and its active cover. `values` are bound to `cookbookIdsSql`.
 */
export function cookbookPreviewQuery(cookbookIdsSql: string, ...values: unknown[]): D1Query {
  return [
    `SELECT ${selectColumns(RECIPE_IN_COOKBOOK_COLUMNS, "e")},
       ${selectColumns(PREVIEW_RECIPE_COLUMNS, "r", "recipe_")},
       ${selectColumns(RECIPE_COVER_COLUMNS, "rc", "cover_")}
     FROM (
       SELECT ric.*, ROW_NUMBER() OVER (
         PARTITION BY ric."cookbookId" ORDER BY ric."createdAt" DESC, ric."id" DESC
       ) AS "previewRank"
       FROM "RecipeInCookbook" ric
       JOIN "Recipe" live ON live."id" = ric."recipeId" AND live."deletedAt" IS NULL
       WHERE ric."cookbookId" IN (${cookbookIdsSql})
     ) e
     JOIN "Recipe" r ON r."id" = e."recipeId"
     LEFT JOIN "RecipeCover" rc ON rc."id" = r."activeCoverId" AND rc."recipeId" = r."id"
     WHERE e."previewRank" <= ${COOKBOOK_PREVIEW_RECIPES}
     ORDER BY e."cookbookId", e."previewRank"`,
    ...values,
  ];
}

/** Preview entries by cookbook id, newest first, from `cookbookPreviewQuery` rows. */
export function cookbookPreviewsById(rows: D1Row[]): Map<string, CookbookPreviewEntry[]> {
  return groupRows(
    rows.map((row) => ({
      ...mapModel(RECIPE_IN_COOKBOOK_COLUMNS, row),
      recipe: {
        ...mapModel(PREVIEW_RECIPE_COLUMNS, row, "recipe_"),
        // Display only uses the active cover (see getRecipeCoverDisplay), and the join
        // requires it to belong to the recipe, as the `covers` relation did.
        covers: row.cover_id === null ? [] : [mapModel(RECIPE_COVER_COLUMNS, row, "cover_")],
      },
    })),
    (entry) => entry.cookbookId,
  );
}
