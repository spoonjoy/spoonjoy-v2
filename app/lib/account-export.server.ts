import type { PrismaClient } from "@prisma/client";

// A copy of everything a person put into Spoonjoy, as one JSON document they can download from
// account settings or GET /api/v1/me/export: their profile, recipes (with steps, ingredients and
// covers), cookbooks, shopping list and cooks (spoons). Stored photos are listed as absolute URLs.
// Secrets (password hashes, tokens, passkey keys) are never included.

export const ACCOUNT_EXPORT_FORMAT = "spoonjoy.account-export.v1";

type ExportDb = Pick<PrismaClient, "user" | "recipe" | "cookbook" | "shoppingList" | "recipeSpoon">;

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/** A stored `/photos/...` URL made absolute against `origin`; other URLs are returned as they are. */
function photoUrl(value: string | null | undefined, origin: string): string | null {
  if (!value) return null;
  return value.startsWith("/") ? `${origin}${value}` : value;
}

export interface AccountExport {
  format: typeof ACCOUNT_EXPORT_FORMAT;
  exportedAt: string;
  account: {
    id: string;
    username: string;
    email: string;
    photoUrl: string | null;
    createdAt: string | null;
    signInMethods: string[];
  };
  recipes: Array<{
    id: string;
    title: string;
    description: string | null;
    servings: string | null;
    sourceUrl: string | null;
    forkedFromRecipeId: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    deletedAt: string | null;
    url: string;
    steps: Array<{
      stepNum: number;
      title: string | null;
      description: string;
      durationMinutes: number | null;
      usesOutputOfSteps: number[];
      ingredients: Array<{ quantity: number; unit: string; name: string }>;
    }>;
    covers: Array<{
      id: string;
      active: boolean;
      status: string;
      sourceType: string;
      imageUrl: string | null;
      stylizedImageUrl: string | null;
      sourceImageUrl: string | null;
      createdAt: string | null;
    }>;
  }>;
  cookbooks: Array<{
    id: string;
    title: string;
    createdAt: string | null;
    recipes: Array<{ id: string; title: string; chef: string; addedAt: string | null }>;
  }>;
  shoppingList: Array<{
    name: string;
    quantity: number | null;
    unit: string | null;
    checked: boolean;
    category: string | null;
  }>;
  cooks: Array<{
    id: string;
    recipeId: string;
    recipeTitle: string;
    cookedAt: string | null;
    note: string | null;
    nextTime: string | null;
    photoUrl: string | null;
  }>;
}

/** Builds the export for `userId`, with photo and recipe URLs made absolute against `origin`. */
export async function buildAccountExport(
  db: ExportDb,
  userId: string,
  origin: string,
  now: Date = new Date(),
): Promise<AccountExport | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      photoUrl: true,
      createdAt: true,
      hashedPassword: true,
      OAuth: { select: { provider: true }, orderBy: { provider: "asc" } },
      _count: { select: { credentials: true } },
    },
  });
  if (!user) return null;

  const [recipes, cookbooks, shoppingList, spoons] = await Promise.all([
    db.recipe.findMany({
      where: { chefId: userId },
      orderBy: { createdAt: "asc" },
      include: {
        steps: {
          orderBy: { stepNum: "asc" },
          include: {
            ingredients: { include: { unit: true, ingredientRef: true } },
            usingSteps: { select: { outputStepNum: true }, orderBy: { outputStepNum: "asc" } },
          },
        },
        covers: { orderBy: { createdAt: "asc" } },
      },
    }),
    db.cookbook.findMany({
      where: { authorId: userId },
      orderBy: { createdAt: "asc" },
      include: {
        recipes: {
          orderBy: { createdAt: "asc" },
          include: { recipe: { select: { id: true, title: true, chef: { select: { username: true } } } } },
        },
      },
    }),
    db.shoppingList.findUnique({
      where: { authorId: userId },
      include: {
        items: {
          where: { deletedAt: null },
          orderBy: { sortIndex: "asc" },
          include: { unit: true, ingredientRef: true },
        },
      },
    }),
    db.recipeSpoon.findMany({
      where: { chefId: userId, deletedAt: null },
      orderBy: { cookedAt: "asc" },
      include: { recipe: { select: { title: true } } },
    }),
  ]);

  const signInMethods = [
    ...(user.hashedPassword ? ["password"] : []),
    ...(user._count.credentials > 0 ? ["passkey"] : []),
    ...user.OAuth.map((link) => link.provider),
  ];

  return {
    format: ACCOUNT_EXPORT_FORMAT,
    exportedAt: now.toISOString(),
    account: {
      id: user.id,
      username: user.username,
      email: user.email,
      photoUrl: photoUrl(user.photoUrl, origin),
      createdAt: iso(user.createdAt),
      signInMethods,
    },
    recipes: recipes.map((recipe) => ({
      id: recipe.id,
      title: recipe.title,
      description: recipe.description,
      servings: recipe.servings,
      sourceUrl: recipe.sourceUrl,
      forkedFromRecipeId: recipe.sourceRecipeId,
      createdAt: iso(recipe.createdAt),
      updatedAt: iso(recipe.updatedAt),
      deletedAt: iso(recipe.deletedAt),
      url: `${origin}/recipes/${recipe.id}`,
      steps: recipe.steps.map((step) => ({
        stepNum: step.stepNum,
        title: step.stepTitle,
        description: step.description,
        durationMinutes: step.duration,
        usesOutputOfSteps: step.usingSteps.map((use) => use.outputStepNum),
        ingredients: step.ingredients.map((ingredient) => ({
          quantity: ingredient.quantity,
          unit: ingredient.unit.name,
          name: ingredient.ingredientRef.name,
        })),
      })),
      covers: recipe.covers.map((cover) => ({
        id: cover.id,
        active: cover.id === recipe.activeCoverId,
        status: cover.status,
        sourceType: cover.sourceType,
        imageUrl: photoUrl(cover.imageUrl, origin),
        stylizedImageUrl: photoUrl(cover.stylizedImageUrl, origin),
        sourceImageUrl: photoUrl(cover.sourceImageUrl, origin),
        createdAt: iso(cover.createdAt),
      })),
    })),
    cookbooks: cookbooks.map((cookbook) => ({
      id: cookbook.id,
      title: cookbook.title,
      createdAt: iso(cookbook.createdAt),
      recipes: cookbook.recipes.map((entry) => ({
        id: entry.recipe.id,
        title: entry.recipe.title,
        chef: entry.recipe.chef.username,
        addedAt: iso(entry.createdAt),
      })),
    })),
    shoppingList: (shoppingList?.items ?? []).map((item) => ({
      name: item.ingredientRef.name,
      quantity: item.quantity,
      unit: item.unit?.name ?? null,
      checked: item.checked,
      category: item.categoryKey,
    })),
    cooks: spoons.map((spoon) => ({
      id: spoon.id,
      recipeId: spoon.recipeId,
      recipeTitle: spoon.recipe.title,
      cookedAt: iso(spoon.cookedAt),
      note: spoon.note,
      nextTime: spoon.nextTime,
      photoUrl: photoUrl(spoon.photoUrl, origin),
    })),
  };
}

/** The file name a download of the export gets, for example `spoonjoy-ada-2026-10-09.json`. */
export function accountExportFileName(username: string, now: Date): string {
  const safe = username.replace(/[^A-Za-z0-9._-]/g, "-");
  return `spoonjoy-${safe}-${now.toISOString().slice(0, 10)}.json`;
}
