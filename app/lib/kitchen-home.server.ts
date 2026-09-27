import type { Cookbook, PrismaClient, Recipe, RecipeCover, RecipeInCookbook } from "@prisma/client";
import { d1Count, d1ReadBatch, type D1ReadDatabase, type D1Row } from "~/lib/d1-read.server";
import { COOKBOOK_COLUMNS, mapModel, RECIPE_COVER_COLUMNS, selectColumns } from "~/lib/d1-models.server";
import {
  COOKBOOK_PREVIEW_RECIPES,
  cookbookPreviewQuery,
  cookbookPreviewsById,
} from "~/lib/cookbook-previews.server";

// Reads behind the kitchen home page (`/`, `/?chef=…`). The Prisma reader is the
// original query; the D1 reader returns the same shapes in one batch.

export type KitchenUserWhere = { id: string } | { username: string };

type RecipeCoverFields = Pick<Recipe, "activeCoverId" | "activeCoverVariant" | "coverMode">;

export interface KitchenHomeRows {
  viewer: { id: string; username: string; email: string; photoUrl: string | null } | null;
  kitchenUser: { id: string; username: string; photoUrl: string | null } | null;
  recipes: Array<
    Pick<Recipe, "id" | "title" | "description" | "servings"> & RecipeCoverFields & { covers: RecipeCover[] }
  >;
  cookbooks: Array<
    Cookbook & {
      _count: { recipes: number };
      recipes: Array<
        RecipeInCookbook & {
          recipe: Pick<Recipe, "id" | "title"> & RecipeCoverFields & { covers: RecipeCover[] };
        }
      >;
    }
  >;
}

export interface KitchenHomeInput {
  viewerId: string | null;
  kitchenUserWhere: KitchenUserWhere;
}


export async function readKitchenHomeWithPrisma(
  database: PrismaClient,
  { viewerId, kitchenUserWhere }: KitchenHomeInput,
): Promise<KitchenHomeRows> {
  const viewer = viewerId
    ? await database.user.findUnique({
        where: { id: viewerId },
        select: { id: true, username: true, email: true, photoUrl: true },
      })
    : null;

  const kitchenUser = await database.user.findUnique({
    where: kitchenUserWhere,
    select: { id: true, username: true, photoUrl: true },
  });

  if (!kitchenUser) {
    return { viewer, kitchenUser: null, recipes: [], cookbooks: [] };
  }

  const [recipes, cookbooks] = await Promise.all([
    database.recipe.findMany({
      where: { chefId: kitchenUser.id, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        servings: true,
        activeCoverId: true,
        activeCoverVariant: true,
        coverMode: true,
        covers: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
      },
    }),
    database.cookbook.findMany({
      where: { authorId: kitchenUser.id },
      orderBy: { updatedAt: "desc" },
      include: {
        // A deleted recipe stays in its cookbooks, but the card neither counts nor shows it.
        _count: { select: { recipes: { where: { recipe: { deletedAt: null } } } } },
        recipes: {
          where: { recipe: { deletedAt: null } },
          take: COOKBOOK_PREVIEW_RECIPES,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: {
            recipe: {
              select: {
                id: true,
                title: true,
                activeCoverId: true,
                activeCoverVariant: true,
                coverMode: true,
                covers: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
              },
            },
          },
        },
      },
    }),
  ]);

  return { viewer, kitchenUser, recipes, cookbooks };
}

function kitchenUserCondition(where: KitchenUserWhere): { sql: string; value: string } {
  return "id" in where ? { sql: `"id" = ?`, value: where.id } : { sql: `"username" = ?`, value: where.username };
}

function nullableString(value: unknown, column: string): string | null {
  if (value === null || typeof value === "string") return value;
  throw new Error(`D1 column ${column} is not a string`);
}

function requiredString(value: unknown, column: string): string {
  if (typeof value === "string") return value;
  throw new Error(`D1 column ${column} is not a string`);
}

function recipeCoverFields(row: D1Row): RecipeCoverFields {
  return {
    activeCoverId: nullableString(row.activeCoverId, "activeCoverId"),
    activeCoverVariant: nullableString(row.activeCoverVariant, "activeCoverVariant"),
    coverMode: requiredString(row.coverMode, "coverMode"),
  };
}

// Display only ever uses a recipe's active cover (getRecipeCoverDisplay finds the cover
// whose id is activeCoverId), so the D1 reader joins that one cover instead of loading
// every cover in the recipe's history. The join also requires the cover to belong to the
// recipe, as the `covers` relation did.
function activeCovers(row: D1Row): RecipeCover[] {
  return row.cover_id === null ? [] : [mapModel(RECIPE_COVER_COLUMNS, row, "cover_")];
}

const ACTIVE_COVER_JOIN = `LEFT JOIN "RecipeCover" rc ON rc."id" = r."activeCoverId" AND rc."recipeId" = r."id"`;

/**
 * The kitchen home reads as one D1 batch. Every statement finds the kitchen owner through
 * the same condition, so the owner's recipes (not deleted) and cookbooks come back in the
 * same round trip as the owner. Results match `readKitchenHomeWithPrisma`, except that a
 * recipe's `covers` holds only its active cover. A cookbook card counts and previews only
 * recipes that are not deleted, newest four first.
 */
export async function readKitchenHomeFromD1(
  db: D1ReadDatabase,
  { viewerId, kitchenUserWhere }: KitchenHomeInput,
): Promise<KitchenHomeRows> {
  const owner = kitchenUserCondition(kitchenUserWhere);
  const ownerId = `(SELECT "id" FROM "User" WHERE ${owner.sql})`;
  const coverSelect = selectColumns(RECIPE_COVER_COLUMNS, "rc", "cover_");
  const [viewerRows, kitchenUserRows, recipeRows, cookbookRows, previewRows] = await d1ReadBatch(db, [
    viewerId
      ? [`SELECT "id", "username", "email", "photoUrl" FROM "User" WHERE "id" = ? LIMIT 1`, viewerId]
      : [`SELECT NULL AS "id" WHERE 0`],
    [`SELECT "id", "username", "photoUrl" FROM "User" WHERE ${owner.sql} LIMIT 1`, owner.value],
    [
      `SELECT r."id", r."title", r."description", r."servings", r."activeCoverId", r."activeCoverVariant", r."coverMode", ${coverSelect}
       FROM "Recipe" r ${ACTIVE_COVER_JOIN}
       WHERE r."chefId" = ${ownerId} AND r."deletedAt" IS NULL
       ORDER BY r."updatedAt" DESC`,
      owner.value,
    ],
    [
      `SELECT ${selectColumns(COOKBOOK_COLUMNS, "c")},
         (SELECT COUNT(*) FROM "RecipeInCookbook" ric
          JOIN "Recipe" live ON live."id" = ric."recipeId" AND live."deletedAt" IS NULL
          WHERE ric."cookbookId" = c."id") AS "recipeCount"
       FROM "Cookbook" c
       WHERE c."authorId" = ${ownerId}
       ORDER BY c."updatedAt" DESC`,
      owner.value,
    ],
    cookbookPreviewQuery(`SELECT "id" FROM "Cookbook" WHERE "authorId" = ${ownerId}`, owner.value),
  ]);

  const viewerRow = viewerRows[0];
  const viewer = viewerRow
    ? {
        id: requiredString(viewerRow.id, "id"),
        username: requiredString(viewerRow.username, "username"),
        email: requiredString(viewerRow.email, "email"),
        photoUrl: nullableString(viewerRow.photoUrl, "photoUrl"),
      }
    : null;

  const kitchenUserRow = kitchenUserRows[0];
  if (!kitchenUserRow) {
    return { viewer, kitchenUser: null, recipes: [], cookbooks: [] };
  }
  const kitchenUser = {
    id: requiredString(kitchenUserRow.id, "id"),
    username: requiredString(kitchenUserRow.username, "username"),
    photoUrl: nullableString(kitchenUserRow.photoUrl, "photoUrl"),
  };

  const recipes = recipeRows.map((row) => ({
    id: requiredString(row.id, "id"),
    title: requiredString(row.title, "title"),
    description: nullableString(row.description, "description"),
    servings: nullableString(row.servings, "servings"),
    ...recipeCoverFields(row),
    covers: activeCovers(row),
  }));

  const previews = cookbookPreviewsById(previewRows);
  const cookbooks = cookbookRows.map((row) => {
    const cookbook = mapModel(COOKBOOK_COLUMNS, row);
    return {
      ...cookbook,
      _count: { recipes: d1Count(row.recipeCount, "recipeCount") },
      recipes: previews.get(cookbook.id) ?? [],
    };
  });

  return { viewer, kitchenUser, recipes, cookbooks };
}
