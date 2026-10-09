import type { Prisma, PrismaClient, RecipeSpoon } from "@prisma/client";
import { d1Count, d1ReadBatch, type D1ReadDatabase, type D1Row } from "~/lib/d1-read.server";
import {
  CHEF_CARD_COLUMNS,
  COOKBOOK_COLUMNS,
  mapModel,
  RECIPE_COVER_COLUMNS,
  RECIPE_SPOON_COLUMNS,
  selectColumns,
  type ColumnSpec,
} from "~/lib/d1-models.server";
import { COOKBOOK_PREVIEW_RECIPES, cookbookPreviewQuery, cookbookPreviewsById } from "~/lib/cookbook-previews.server";
import { chefGraphCountSql, countFellowChefs, countKitchenVisitors } from "~/lib/fellow-chefs.server";
import type { KitchenHomeRows } from "~/lib/kitchen-home.server";

// Reads behind a chef's profile (`/users/:identifier`). The Prisma reader is the fallback
// where there is no D1 binding (unit tests, scripts); the D1 reader returns the same data
// in one batch. Before this, the profile issued its reads through Prisma one round trip
// at a time and loaded every recipe the chef ever wrote with every cover in each
// recipe's history; recipes are now paged.

export const PROFILE_SPOON_LIMIT = 10;

type ProfileRecipe = KitchenHomeRows["recipes"][number];
type ProfileCookbook = KitchenHomeRows["cookbooks"][number];
type ChefCard = { id: string; username: string; photoUrl: string | null };

export type ProfileSpoon = RecipeSpoon & {
  chef: ChefCard;
  recipe: Pick<ProfileRecipe, "id" | "title" | "activeCoverId" | "activeCoverVariant" | "coverMode" | "covers"> & {
    chefId: string;
  };
};

export interface ChefProfileRows {
  /** Null when no user has this username or id; nothing else is read then. */
  profileUser: { id: string; username: string; photoUrl: string | null; createdAt: Date } | null;
  /** Whether the identifier matched the username (canonical URL) or only the id. */
  matchedBy: "username" | "id" | null;
  recipes: ProfileRecipe[];
  /** Every recipe the chef has that is not deleted, across all pages. */
  recipeCount: number;
  cookbooks: ProfileCookbook[];
  recentSpoons: ProfileSpoon[];
  fellowChefsCount: number;
  kitchenVisitorsCount: number;
}

export interface ChefProfileInput {
  identifier: string;
  /** Recipes to return; null returns every one. */
  recipeLimit: number | null;
  recipeOffset: number;
}

const EMPTY: Omit<ChefProfileRows, "profileUser" | "matchedBy"> = {
  recipes: [],
  recipeCount: 0,
  cookbooks: [],
  recentSpoons: [],
  fellowChefsCount: 0,
  kitchenVisitorsCount: 0,
};

const RECIPE_CARD_SELECT = {
  id: true,
  title: true,
  activeCoverId: true,
  activeCoverVariant: true,
  coverMode: true,
  covers: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
} satisfies Prisma.RecipeSelect;

export async function readChefProfileWithPrisma(
  database: PrismaClient,
  { identifier, recipeLimit, recipeOffset }: ChefProfileInput,
): Promise<ChefProfileRows> {
  const userSelect = { id: true, username: true, photoUrl: true, createdAt: true } as const;
  const byUsername = await database.user.findUnique({ where: { username: identifier }, select: userSelect });
  const profileUser = byUsername ?? await database.user.findUnique({ where: { id: identifier }, select: userSelect });
  if (!profileUser) return { profileUser: null, matchedBy: null, ...EMPTY };
  const matchedBy = byUsername ? "username" : "id";

  const liveRecipe = { chefId: profileUser.id, deletedAt: null };
  const [recipes, recipeCount, cookbooks, recentSpoons, fellowChefsCount, kitchenVisitorsCount] = await Promise.all([
    database.recipe.findMany({
      where: liveRecipe,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      ...(recipeLimit === null ? {} : { take: recipeLimit }),
      skip: recipeOffset,
      select: { ...RECIPE_CARD_SELECT, description: true, servings: true },
    }),
    database.recipe.count({ where: liveRecipe }),
    database.cookbook.findMany({
      where: { authorId: profileUser.id },
      orderBy: { updatedAt: "desc" },
      include: {
        // A deleted recipe stays in its cookbooks, but the card neither counts nor shows it.
        _count: { select: { recipes: { where: { recipe: { deletedAt: null } } } } },
        recipes: {
          where: { recipe: { deletedAt: null } },
          take: COOKBOOK_PREVIEW_RECIPES,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: { recipe: { select: RECIPE_CARD_SELECT } },
        },
      },
    }),
    database.recipeSpoon.findMany({
      where: { chefId: profileUser.id, deletedAt: null },
      orderBy: [{ cookedAt: "desc" }, { id: "desc" }],
      take: PROFILE_SPOON_LIMIT,
      include: {
        recipe: { select: { ...RECIPE_CARD_SELECT, chefId: true } },
        chef: { select: { id: true, username: true, photoUrl: true } },
      },
    }),
    countFellowChefs(database, profileUser.id),
    countKitchenVisitors(database, profileUser.id),
  ]);

  return { profileUser, matchedBy, recipes, recipeCount, cookbooks, recentSpoons, fellowChefsCount, kitchenVisitorsCount };
}

const PROFILE_USER_COLUMNS: ColumnSpec<NonNullable<ChefProfileRows["profileUser"]>> = {
  id: "string",
  username: "string",
  photoUrl: "string?",
  createdAt: "dateTime",
};

const RECIPE_CARD_COLUMNS: ColumnSpec<Omit<ProfileRecipe, "covers">> = {
  id: "string",
  title: "string",
  description: "string?",
  servings: "string?",
  activeCoverId: "string?",
  activeCoverVariant: "string?",
  coverMode: "string",
};

const SPOON_RECIPE_COLUMNS: ColumnSpec<Omit<ProfileSpoon["recipe"], "covers">> = {
  id: "string",
  title: "string",
  chefId: "string",
  activeCoverId: "string?",
  activeCoverVariant: "string?",
  coverMode: "string",
};

// Display only ever uses a recipe's active cover (getRecipeCoverDisplay finds the cover
// whose id is activeCoverId), so the D1 reader joins that one cover. The join also
// requires the cover to belong to the recipe, as the `covers` relation did.
function activeCover(row: D1Row) {
  return row.cover_id === null ? [] : [mapModel(RECIPE_COVER_COLUMNS, row, "cover_")];
}

/**
 * The profile as one D1 batch. Every statement finds the chef through the same
 * subquery (username first, then id), so nothing waits on the user lookup. Results
 * match `readChefProfileWithPrisma`, except that a recipe's `covers` holds only its
 * active cover.
 */
export async function readChefProfileFromD1(
  db: D1ReadDatabase,
  { identifier, recipeLimit, recipeOffset }: ChefProfileInput,
): Promise<ChefProfileRows> {
  // Plain `?` placeholders, each bound in order: `chefId` takes the identifier twice.
  const chefId = `COALESCE((SELECT "id" FROM "User" WHERE "username" = ?), (SELECT "id" FROM "User" WHERE "id" = ?))`;
  const chef = [identifier, identifier];
  const coverSelect = selectColumns(RECIPE_COVER_COLUMNS, "rc", "cover_");
  const coverJoin = `LEFT JOIN "RecipeCover" rc ON rc."id" = r."activeCoverId" AND rc."recipeId" = r."id"`;

  const [userRows, recipeRows, countRows, cookbookRows, previewRows, spoonRows, fellowRows, visitorRows] = await d1ReadBatch(db, [
    [`SELECT ${selectColumns(PROFILE_USER_COLUMNS, "u")}, (u."username" = ?) AS "byUsername" FROM "User" u WHERE u."id" = ${chefId}`, identifier, ...chef],
    [
      `SELECT ${selectColumns(RECIPE_CARD_COLUMNS, "r")}, ${coverSelect}
       FROM "Recipe" r ${coverJoin}
       WHERE r."chefId" = ${chefId} AND r."deletedAt" IS NULL
       ORDER BY r."updatedAt" DESC, r."createdAt" DESC, r."id" DESC
       LIMIT ? OFFSET ?`,
      ...chef,
      // SQLite reads a negative LIMIT as no limit.
      recipeLimit ?? -1,
      recipeOffset,
    ],
    [`SELECT COUNT(*) AS "total" FROM "Recipe" WHERE "chefId" = ${chefId} AND "deletedAt" IS NULL`, ...chef],
    [
      `SELECT ${selectColumns(COOKBOOK_COLUMNS, "c")},
         (SELECT COUNT(*) FROM "RecipeInCookbook" ric
          JOIN "Recipe" live ON live."id" = ric."recipeId" AND live."deletedAt" IS NULL
          WHERE ric."cookbookId" = c."id") AS "recipeCount"
       FROM "Cookbook" c
       WHERE c."authorId" = ${chefId}
       ORDER BY c."updatedAt" DESC`,
      ...chef,
    ],
    cookbookPreviewQuery(`SELECT "id" FROM "Cookbook" WHERE "authorId" = ${chefId}`, ...chef),
    [
      `SELECT ${selectColumns(RECIPE_SPOON_COLUMNS, "sp")},
         ${selectColumns(SPOON_RECIPE_COLUMNS, "r", "recipe_")},
         ${coverSelect},
         ${selectColumns(CHEF_CARD_COLUMNS, "u", "chef_")}
       FROM "RecipeSpoon" sp
       JOIN "Recipe" r ON r."id" = sp."recipeId"
       ${coverJoin}
       JOIN "User" u ON u."id" = sp."chefId"
       WHERE sp."chefId" = ${chefId} AND sp."deletedAt" IS NULL
       ORDER BY sp."cookedAt" DESC, sp."id" DESC
       LIMIT ${PROFILE_SPOON_LIMIT}`,
      ...chef,
    ],
    // The chef-graph CTE names the focal chef six times.
    [chefGraphCountSql("viewer", chefId), ...Array.from({ length: 6 }, () => chef).flat()],
    [chefGraphCountSql("chef", chefId), ...Array.from({ length: 6 }, () => chef).flat()],
  ]);

  const userRow = userRows[0];
  if (!userRow) return { profileUser: null, matchedBy: null, ...EMPTY };

  const previews = cookbookPreviewsById(previewRows);
  return {
    profileUser: mapModel(PROFILE_USER_COLUMNS, userRow),
    matchedBy: userRow.byUsername === 1 ? "username" : "id",
    recipes: recipeRows.map((row) => ({ ...mapModel(RECIPE_CARD_COLUMNS, row), covers: activeCover(row) })),
    recipeCount: d1Count(countRows[0]?.total, "total"),
    cookbooks: cookbookRows.map((row) => {
      const cookbook = mapModel(COOKBOOK_COLUMNS, row);
      return {
        ...cookbook,
        _count: { recipes: d1Count(row.recipeCount, "recipeCount") },
        recipes: previews.get(cookbook.id) ?? [],
      };
    }),
    recentSpoons: spoonRows.map((row) => ({
      ...mapModel(RECIPE_SPOON_COLUMNS, row),
      recipe: { ...mapModel(SPOON_RECIPE_COLUMNS, row, "recipe_"), covers: activeCover(row) },
      chef: mapModel(CHEF_CARD_COLUMNS, row, "chef_"),
    })),
    fellowChefsCount: d1Count(fellowRows[0]?.total, "total"),
    kitchenVisitorsCount: d1Count(visitorRows[0]?.total, "total"),
  };
}
