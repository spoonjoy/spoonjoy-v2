import type { PrismaClient as PrismaClientType, RecipeCover } from "@prisma/client";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "~/lib/account-settings.server";
import type { ApiV1ErrorCode } from "~/lib/api-v1-contract.server";
import {
  getRecipeCoverDisplay,
  getScopedActiveCover,
  RECIPE_COVER_DISPLAY_SELECT,
  type RecipeCoverVariant,
} from "~/lib/recipe-cover.server";

type Database = PrismaClientType;

type NativeSyncKind =
  | "profile"
  | "notificationPreferences"
  | "recipe"
  | "cookbook"
  | "spoon"
  | "shoppingItem";

type NativeSyncAction = "upsert" | "delete";

type NativeSyncCursor = {
  updatedAt: Date;
  kind: NativeSyncKind | null;
  resourceId: string | null;
  raw: string;
};

type NativeSyncEntry = {
  action: NativeSyncAction;
  kind: NativeSyncKind;
  resourceId: string;
  updatedAt: string;
  payload: Record<string, unknown> | null;
  tombstone: NativeSyncTombstone | null;
};

type NativeSyncTombstone = {
  resourceType: string;
  resourceId: string;
  parentResourceId: string | null;
  title: string | null;
  deletedAt: string;
  updatedAt: string;
};

export type ApiV1NativeSyncResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; code: ApiV1ErrorCode; message: string; details?: unknown };

const DEFAULT_SYNC_LIMIT = 20;
const MAX_SYNC_LIMIT = 50;
const NATIVE_SYNC_SCHEMA_VERSION = 1;
const NATIVE_SYNC_KIND_ORDER: readonly NativeSyncKind[] = [
  "profile",
  "notificationPreferences",
  "recipe",
  "cookbook",
  "spoon",
  "shoppingItem",
];

const NATIVE_SYNC_KIND_RANK = Object.fromEntries(
  NATIVE_SYNC_KIND_ORDER.map((kind, index) => [kind, index]),
) as Record<NativeSyncKind, number>;

function success<T>(data: T, status = 200): ApiV1NativeSyncResult<T> {
  return { ok: true, status, data };
}

function failure<T>(code: ApiV1ErrorCode, message: string, details?: unknown): ApiV1NativeSyncResult<T> {
  return { ok: false, code, message, details };
}

function base64UrlEncodeText(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecodeText(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

function strictIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.toISOString() !== value ? null : date;
}

function parseNativeSyncLimit(url: URL): ApiV1NativeSyncResult<number> {
  const raw = url.searchParams.get("limit");
  if (raw === null || raw.trim() === "") return success(DEFAULT_SYNC_LIMIT);
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SYNC_LIMIT) {
    return failure("validation_error", "limit must be an integer between 1 and 50");
  }
  return success(limit);
}

function parseNativeSyncKind(value: unknown): NativeSyncKind | null {
  return typeof value === "string" && value in NATIVE_SYNC_KIND_RANK
    ? value as NativeSyncKind
    : null;
}

function parseNativeSyncCursor(url: URL): ApiV1NativeSyncResult<NativeSyncCursor | null> {
  const raw = url.searchParams.get("cursor");
  if (raw === null || raw.trim() === "") return success(null);
  const trimmed = raw.trim();
  if (trimmed.startsWith("v1.")) {
    try {
      const parsed = JSON.parse(base64UrlDecodeText(trimmed.slice(3))) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return failure("invalid_cursor", "cursor must be an ISO datetime or Spoonjoy native sync cursor");
      }
      const updatedAtRaw = (parsed as { updatedAt?: unknown }).updatedAt;
      const kind = parseNativeSyncKind((parsed as { kind?: unknown }).kind);
      const resourceId = (parsed as { resourceId?: unknown }).resourceId;
      if (typeof updatedAtRaw !== "string" || kind === null || typeof resourceId !== "string") {
        return failure("invalid_cursor", "cursor must be an ISO datetime or Spoonjoy native sync cursor");
      }
      const updatedAt = strictIsoDate(updatedAtRaw);
      if (!updatedAt) {
        return failure("invalid_cursor", "cursor must be an ISO datetime or Spoonjoy native sync cursor");
      }
      return success({ updatedAt, kind, resourceId, raw: trimmed });
    } catch {
      return failure("invalid_cursor", "cursor must be an ISO datetime or Spoonjoy native sync cursor");
    }
  }
  const updatedAt = strictIsoDate(trimmed);
  if (!updatedAt) {
    return failure("invalid_cursor", "cursor must be an ISO datetime or Spoonjoy native sync cursor");
  }
  return success({ updatedAt, kind: null, resourceId: null, raw: trimmed });
}

function nativeSyncCursorFor(entry: NativeSyncEntry): string {
  return `v1.${base64UrlEncodeText(JSON.stringify({
    updatedAt: entry.updatedAt,
    kind: entry.kind,
    resourceId: entry.resourceId,
  }))}`;
}

function compareNativeSyncEntries(a: NativeSyncEntry, b: NativeSyncEntry): number {
  const updatedAtDelta = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
  if (updatedAtDelta !== 0) return updatedAtDelta;
  const kindDelta = NATIVE_SYNC_KIND_RANK[a.kind] - NATIVE_SYNC_KIND_RANK[b.kind];
  if (kindDelta !== 0) return kindDelta;
  return a.resourceId.localeCompare(b.resourceId);
}

function entryIsAfterCursor(entry: NativeSyncEntry, cursor: NativeSyncCursor | null): boolean {
  if (!cursor) return true;
  const updatedAt = new Date(entry.updatedAt).getTime();
  const cursorUpdatedAt = cursor.updatedAt.getTime();
  if (updatedAt > cursorUpdatedAt) return true;
  if (updatedAt < cursorUpdatedAt || cursor.kind === null || cursor.resourceId === null) return false;
  const entryRank = NATIVE_SYNC_KIND_RANK[entry.kind];
  const cursorRank = NATIVE_SYNC_KIND_RANK[cursor.kind];
  if (entryRank > cursorRank) return true;
  return entryRank === cursorRank && entry.resourceId > cursor.resourceId;
}

function upsertEntry(kind: NativeSyncKind, resourceId: string, updatedAt: Date, payload: Record<string, unknown>): NativeSyncEntry {
  return {
    action: "upsert",
    kind,
    resourceId,
    updatedAt: updatedAt.toISOString(),
    payload,
    tombstone: null,
  };
}

function deleteEntry(kind: NativeSyncKind, resourceId: string, updatedAt: Date, tombstone: NativeSyncTombstone): NativeSyncEntry {
  return {
    action: "delete",
    kind,
    resourceId,
    updatedAt: updatedAt.toISOString(),
    payload: null,
    tombstone,
  };
}

function preferencePayload(userId: string, updatedAt: Date, prefRow: {
  notifySpoonOnMyRecipe: boolean;
  notifyForkOfMyRecipe: boolean;
  notifyCookbookSaveOfMine: boolean;
  notifyFellowChefOriginCook: boolean;
} | null) {
  const preferences = prefRow ?? DEFAULT_NOTIFICATION_PREFERENCES;
  return {
    userId,
    notifySpoonOnMyRecipe: preferences.notifySpoonOnMyRecipe,
    notifyForkOfMyRecipe: preferences.notifyForkOfMyRecipe,
    notifyCookbookSaveOfMine: preferences.notifyCookbookSaveOfMine,
    notifyFellowChefOriginCook: preferences.notifyFellowChefOriginCook,
    updatedAt: updatedAt.toISOString(),
  };
}

function canonicalUrl(origin: string, href: string): string {
  return new URL(href, origin).toString();
}

function publicAssetUrl(origin: string, value: string | null): string | null {
  if (!value || value.startsWith("data:")) return null;
  try {
    return new URL(value, origin).toString();
  } catch {
    return null;
  }
}

type SourceRecipeRow = {
  id: string;
  title: string;
  deletedAt: Date | null;
  updatedAt: Date;
  chef: { id: string; username: string };
} | null;

function sourceHost(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null;
  try {
    return new URL(sourceUrl).hostname || null;
  } catch {
    return null;
  }
}

function recipeAttribution(recipe: {
  title: string;
  chef: { username: string };
  href: string;
  sourceUrl: string | null;
  sourceRecipe: SourceRecipeRow;
}, origin: string) {
  const sourceRecipeHref = recipe.sourceRecipe ? `/recipes/${recipe.sourceRecipe.id}` : null;
  const sourceRecipeDeleted = Boolean(recipe.sourceRecipe?.deletedAt);
  return {
    creditText: `${recipe.title} by ${recipe.chef.username} on Spoonjoy`,
    canonicalUrl: canonicalUrl(origin, recipe.href),
    sourceUrl: recipe.sourceUrl,
    sourceHost: sourceHost(recipe.sourceUrl),
    sourceRecipe: recipe.sourceRecipe ? {
      id: recipe.sourceRecipe.id,
      title: sourceRecipeDeleted ? null : recipe.sourceRecipe.title,
      chef: sourceRecipeDeleted ? null : {
        id: recipe.sourceRecipe.chef.id,
        username: recipe.sourceRecipe.chef.username,
      },
      href: sourceRecipeDeleted ? null : sourceRecipeHref,
      canonicalUrl: sourceRecipeDeleted ? null : canonicalUrl(origin, sourceRecipeHref!),
      deleted: sourceRecipeDeleted,
    } : null,
  };
}

type RecipeCoverFieldsInput = {
  id: string;
  title: string;
  activeCoverId: string | null;
  activeCoverVariant: string | null;
  coverMode: string | null;
  activeCover: RecipeCover | null;
};

function emptyRecipeCoverApiFields() {
  return {
    coverImageUrl: null,
    coverProvenanceLabel: null,
    coverSourceType: null,
    coverVariant: null,
  };
}

function recipeCoverApiFields(recipe: RecipeCoverFieldsInput, origin: string) {
  const activeCover = getScopedActiveCover(recipe);
  const coverDisplay = getRecipeCoverDisplay(recipe, activeCover ? [activeCover] : []);
  if (!coverDisplay) return emptyRecipeCoverApiFields();

  const coverImageUrl = publicAssetUrl(origin, coverDisplay.displayUrl);
  if (!coverImageUrl) return emptyRecipeCoverApiFields();
  return {
    coverImageUrl,
    coverProvenanceLabel: coverDisplay.provenanceLabel,
    coverSourceType: coverDisplay.sourceType,
    coverVariant: coverDisplay.activeVariant,
  };
}

function latestDate(...dates: Array<Date | null | undefined>): Date {
  const values = dates.filter((date): date is Date => Boolean(date));
  return values.reduce((latest, date) => date.getTime() > latest.getTime() ? date : latest, values[0]!);
}

function recipeTombstone(recipe: {
  id: string;
  title: string;
  deletedAt: Date;
  updatedAt: Date;
}): NativeSyncTombstone {
  return {
    resourceType: "recipe",
    resourceId: recipe.id,
    parentResourceId: null,
    title: recipe.title,
    deletedAt: recipe.deletedAt.toISOString(),
    updatedAt: recipe.updatedAt.toISOString(),
  };
}

function spoonTombstone(spoon: {
  id: string;
  recipeId: string;
  deletedAt: Date;
  updatedAt: Date;
}): NativeSyncTombstone {
  return {
    resourceType: "spoon",
    resourceId: spoon.id,
    parentResourceId: spoon.recipeId,
    title: null,
    deletedAt: spoon.deletedAt.toISOString(),
    updatedAt: spoon.updatedAt.toISOString(),
  };
}

function shoppingItemTombstone(item: {
  id: string;
  shoppingListId: string;
  deletedAt: Date;
  updatedAt: Date;
}): NativeSyncTombstone {
  return {
    resourceType: "shoppingItem",
    resourceId: item.id,
    parentResourceId: item.shoppingListId,
    title: null,
    deletedAt: item.deletedAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function recipeSummary(
  recipe: Awaited<ReturnType<typeof loadNativeSyncRecipes>>[number] | Awaited<ReturnType<typeof loadNativeSyncCookbooks>>[number]["recipes"][number]["recipe"],
  origin: string,
) {
  const href = `/recipes/${recipe.id}`;
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    servings: recipe.servings,
    chef: {
      id: recipe.chef.id,
      username: recipe.chef.username,
    },
    ...recipeCoverApiFields(recipe, origin),
    href,
    canonicalUrl: canonicalUrl(origin, href),
    attribution: recipeAttribution({ ...recipe, href }, origin),
    createdAt: recipe.createdAt.toISOString(),
    updatedAt: recipe.updatedAt.toISOString(),
  };
}

function recipePayload(recipe: Awaited<ReturnType<typeof loadNativeSyncRecipes>>[number], origin: string) {
  return {
    ...recipeSummary(recipe, origin),
    deletedAt: null,
    steps: [...recipe.steps]
      .sort((a, b) => a.stepNum - b.stepNum)
      .map((step) => ({
        id: step.id,
        stepNum: step.stepNum,
        stepTitle: step.stepTitle,
        description: step.description,
        duration: step.duration,
        ingredients: [...step.ingredients]
          .sort((a, b) => a.ingredientRef.name.localeCompare(b.ingredientRef.name))
          .map((ingredient) => ({
            id: ingredient.id,
            name: ingredient.ingredientRef.name,
            quantity: ingredient.quantity,
            unit: ingredient.unit.name,
          })),
        usingSteps: [...step.usingSteps]
          .sort((a, b) => a.outputStepNum - b.outputStepNum)
          .map((use) => ({
            id: use.id,
            inputStepNum: use.inputStepNum,
            outputStepNum: use.outputStepNum,
            outputOfStep: {
              stepNum: use.outputOfStep.stepNum,
              stepTitle: use.outputOfStep.stepTitle,
            },
          })),
      })),
    cookbooks: recipe.cookbooks.map((entry) => ({
      id: entry.cookbook.id,
      title: entry.cookbook.title,
      href: `/cookbooks/${entry.cookbook.id}`,
      canonicalUrl: canonicalUrl(origin, `/cookbooks/${entry.cookbook.id}`),
    })),
    recentSpoons: recipe.spoons.map((spoon) => ({
      id: spoon.id,
      chefId: spoon.chefId,
      recipeId: spoon.recipeId,
      cookedAt: spoon.cookedAt.toISOString(),
      photoUrl: spoon.photoUrl,
      note: spoon.note,
      nextTime: spoon.nextTime,
      deletedAt: null,
      createdAt: spoon.createdAt.toISOString(),
      updatedAt: spoon.updatedAt.toISOString(),
      chef: {
        id: spoon.chef.id,
        username: spoon.chef.username,
        photoUrl: spoon.chef.photoUrl,
      },
    })),
  };
}

function activeCookbookRecipeEntries(cookbook: Awaited<ReturnType<typeof loadNativeSyncCookbooks>>[number]) {
  return cookbook.recipes.filter((entry) => !entry.recipe.deletedAt);
}

function cookbookSummary(cookbook: Awaited<ReturnType<typeof loadNativeSyncCookbooks>>[number], origin: string) {
  const activeEntries = activeCookbookRecipeEntries(cookbook);
  const href = `/cookbooks/${cookbook.id}`;
  return {
    id: cookbook.id,
    title: cookbook.title,
    chef: {
      id: cookbook.author.id,
      username: cookbook.author.username,
    },
    recipeCount: activeEntries.length,
    coverImageUrls: activeEntries
      .map((entry) => recipeCoverApiFields(entry.recipe, origin).coverImageUrl)
      .filter((url): url is string => Boolean(url))
      .slice(0, 4),
    href,
    canonicalUrl: canonicalUrl(origin, href),
    attribution: {
      creditText: `${cookbook.title} by ${cookbook.author.username} on Spoonjoy`,
      canonicalUrl: canonicalUrl(origin, href),
    },
    createdAt: cookbook.createdAt.toISOString(),
    updatedAt: cookbook.updatedAt.toISOString(),
  };
}

function cookbookPayload(cookbook: Awaited<ReturnType<typeof loadNativeSyncCookbooks>>[number], origin: string) {
  return {
    ...cookbookSummary(cookbook, origin),
    deletedAt: null,
    recipes: activeCookbookRecipeEntries(cookbook).map((entry) => recipeSummary(entry.recipe, origin)),
  };
}

function recipeRevisionAt(recipe: Awaited<ReturnType<typeof loadNativeSyncRecipes>>[number]): Date {
  return latestDate(
    recipe.updatedAt,
    recipe.sourceRecipe?.updatedAt,
    recipe.activeCover?.createdAt,
    recipe.activeCover?.archivedAt,
    ...recipe.steps.map((step) => step.updatedAt),
    ...recipe.steps.flatMap((step) => step.ingredients.map((ingredient) => ingredient.updatedAt)),
    ...recipe.steps.flatMap((step) => step.usingSteps.map((use) => use.updatedAt)),
    ...recipe.cookbooks.map((entry) => entry.updatedAt),
    ...recipe.spoons.map((spoon) => spoon.updatedAt),
  );
}

function cookbookRevisionAt(cookbook: Awaited<ReturnType<typeof loadNativeSyncCookbooks>>[number]): Date {
  return latestDate(
    cookbook.updatedAt,
    ...cookbook.recipes.map((entry) => entry.updatedAt),
    ...cookbook.recipes.map((entry) => entry.recipe.updatedAt),
    ...cookbook.recipes.map((entry) => entry.recipe.sourceRecipe?.updatedAt),
    ...cookbook.recipes.map((entry) => entry.recipe.activeCover?.createdAt),
    ...cookbook.recipes.map((entry) => entry.recipe.activeCover?.archivedAt),
  );
}

function spoonPayload(spoon: Awaited<ReturnType<typeof loadNativeSyncSpoons>>[number]) {
  return {
    id: spoon.id,
    chefId: spoon.chefId,
    recipeId: spoon.recipeId,
    cookedAt: spoon.cookedAt.toISOString(),
    photoUrl: spoon.photoUrl,
    note: spoon.note,
    nextTime: spoon.nextTime,
    deletedAt: spoon.deletedAt?.toISOString() ?? null,
    createdAt: spoon.createdAt.toISOString(),
    updatedAt: spoon.updatedAt.toISOString(),
  };
}

function shoppingItemPayload(item: Awaited<ReturnType<typeof loadNativeSyncShoppingItems>>[number]) {
  return {
    id: item.id,
    shoppingListId: item.shoppingListId,
    name: item.ingredientRef.name,
    quantity: item.quantity,
    unit: item.unit?.name ?? null,
    checked: item.checked,
    checkedAt: item.checkedAt?.toISOString() ?? null,
    deletedAt: item.deletedAt?.toISOString() ?? null,
    categoryKey: item.categoryKey,
    iconKey: item.iconKey,
    sortIndex: item.sortIndex,
    updatedAt: item.updatedAt.toISOString(),
  };
}

async function loadNativeSyncRecipes(db: Database, userId: string) {
  return db.recipe.findMany({
    where: { chefId: userId },
    select: {
      id: true,
      title: true,
      description: true,
      servings: true,
      sourceUrl: true,
      activeCoverId: true,
      activeCoverVariant: true,
      coverMode: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      chef: { select: { id: true, username: true } },
      sourceRecipe: {
        select: {
          id: true,
          title: true,
          deletedAt: true,
          updatedAt: true,
          chef: { select: { id: true, username: true } },
        },
      },
      activeCover: { select: RECIPE_COVER_DISPLAY_SELECT },
      steps: {
        select: {
          id: true,
          stepNum: true,
          stepTitle: true,
          description: true,
          duration: true,
          updatedAt: true,
          ingredients: {
            select: {
              id: true,
              quantity: true,
              updatedAt: true,
              unit: { select: { name: true } },
              ingredientRef: { select: { name: true } },
            },
          },
          usingSteps: {
            select: {
              id: true,
              inputStepNum: true,
              outputStepNum: true,
              updatedAt: true,
              outputOfStep: { select: { stepNum: true, stepTitle: true } },
            },
            orderBy: { outputStepNum: "asc" },
          },
        },
      },
      cookbooks: {
        select: {
          updatedAt: true,
          cookbook: { select: { id: true, title: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      spoons: {
        where: { deletedAt: null },
        select: {
          id: true,
          chefId: true,
          recipeId: true,
          cookedAt: true,
          photoUrl: true,
          note: true,
          nextTime: true,
          createdAt: true,
          updatedAt: true,
          chef: { select: { id: true, username: true, photoUrl: true } },
        },
        orderBy: [{ cookedAt: "desc" }, { id: "desc" }],
        take: 10,
      },
    },
  });
}

async function loadNativeSyncCookbooks(db: Database, userId: string) {
  return db.cookbook.findMany({
    where: { authorId: userId },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { id: true, username: true } },
      recipes: {
        select: {
          recipe: {
            select: {
              id: true,
              title: true,
              description: true,
              servings: true,
              sourceUrl: true,
              deletedAt: true,
              activeCoverId: true,
              activeCoverVariant: true,
              coverMode: true,
              createdAt: true,
              updatedAt: true,
              sourceRecipe: {
                select: {
                  id: true,
                  title: true,
                  deletedAt: true,
                  updatedAt: true,
                  chef: { select: { id: true, username: true } },
                },
              },
              activeCover: { select: RECIPE_COVER_DISPLAY_SELECT },
              chef: { select: { id: true, username: true } },
            },
          },
          updatedAt: true,
        },
        orderBy: [{ createdAt: "asc" }, { recipeId: "asc" }],
      },
    },
  });
}

async function loadNativeSyncSpoons(db: Database, userId: string) {
  return db.recipeSpoon.findMany({
    where: { chefId: userId },
    select: {
      id: true,
      chefId: true,
      recipeId: true,
      cookedAt: true,
      photoUrl: true,
      note: true,
      nextTime: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

async function loadNativeSyncShoppingItems(db: Database, userId: string) {
  const list = await db.shoppingList.findUnique({
    where: { authorId: userId },
    select: {
      items: {
        select: {
          id: true,
          shoppingListId: true,
          quantity: true,
          checked: true,
          checkedAt: true,
          deletedAt: true,
          sortIndex: true,
          categoryKey: true,
          iconKey: true,
          updatedAt: true,
          ingredientRef: { select: { name: true } },
          unit: { select: { name: true } },
        },
      },
    },
  });
  return list?.items ?? [];
}

async function loadNativeSyncCookbookTombstones(db: Database, userId: string) {
  return db.nativeSyncTombstone.findMany({
    where: {
      userId,
      resourceType: "cookbook",
    },
    select: {
      resourceType: true,
      resourceId: true,
      parentResourceId: true,
      title: true,
      deletedAt: true,
      updatedAt: true,
      createdAt: true,
    },
  });
}

export async function loadNativeSyncSnapshot(
  db: Database,
  userId: string,
  url: URL,
  options: { environment?: string; origin?: string } = {},
) {
  const cursorResult = parseNativeSyncCursor(url);
  if (!cursorResult.ok) return cursorResult;
  const limitResult = parseNativeSyncLimit(url);
  if (!limitResult.ok) return limitResult;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
      photoUrl: true,
      updatedAt: true,
    },
  });
  if (!user) return failure("not_found", "Account not found");

  const prefRow = await db.notificationPreference.findUnique({
    where: { userId },
    select: {
      notifySpoonOnMyRecipe: true,
      notifyForkOfMyRecipe: true,
      notifyCookbookSaveOfMine: true,
      notifyFellowChefOriginCook: true,
      updatedAt: true,
    },
  });
  const prefUpdatedAt = prefRow?.updatedAt ?? user.updatedAt;

  const entries: NativeSyncEntry[] = [
    upsertEntry("profile", user.id, user.updatedAt, {
      id: user.id,
      email: user.email,
      username: user.username,
      photoUrl: user.photoUrl,
      updatedAt: user.updatedAt.toISOString(),
    }),
    upsertEntry("notificationPreferences", user.id, prefUpdatedAt, preferencePayload(user.id, prefUpdatedAt, prefRow)),
  ];

  const [recipes, cookbooks, spoons, shoppingItems, cookbookTombstones] = await Promise.all([
    loadNativeSyncRecipes(db, userId),
    loadNativeSyncCookbooks(db, userId),
    loadNativeSyncSpoons(db, userId),
    loadNativeSyncShoppingItems(db, userId),
    loadNativeSyncCookbookTombstones(db, userId),
  ]);

  const origin = options.origin ?? "https://spoonjoy.app";

  for (const recipe of recipes) {
    const revisionAt = recipeRevisionAt(recipe);
    if (recipe.deletedAt) {
      entries.push(deleteEntry("recipe", recipe.id, revisionAt, recipeTombstone({
        id: recipe.id,
        title: recipe.title,
        deletedAt: recipe.deletedAt,
        updatedAt: recipe.updatedAt,
      })));
      continue;
    }
    entries.push(upsertEntry("recipe", recipe.id, revisionAt, recipePayload(recipe, origin)));
  }

  for (const cookbook of cookbooks) {
    const revisionAt = cookbookRevisionAt(cookbook);
    entries.push(upsertEntry("cookbook", cookbook.id, revisionAt, cookbookPayload(cookbook, origin)));
  }

  for (const spoon of spoons) {
    if (spoon.deletedAt) {
      entries.push(deleteEntry("spoon", spoon.id, spoon.updatedAt, spoonTombstone({
        id: spoon.id,
        recipeId: spoon.recipeId,
        deletedAt: spoon.deletedAt,
        updatedAt: spoon.updatedAt,
      })));
      continue;
    }
    entries.push(upsertEntry("spoon", spoon.id, spoon.updatedAt, spoonPayload(spoon)));
  }

  for (const item of shoppingItems) {
    if (item.deletedAt) {
      entries.push(deleteEntry("shoppingItem", item.id, item.updatedAt, shoppingItemTombstone({
        id: item.id,
        shoppingListId: item.shoppingListId,
        deletedAt: item.deletedAt,
        updatedAt: item.updatedAt,
      })));
      continue;
    }
    entries.push(upsertEntry("shoppingItem", item.id, item.updatedAt, shoppingItemPayload(item)));
  }

  for (const tombstone of cookbookTombstones) {
    entries.push(deleteEntry("cookbook", tombstone.resourceId, tombstone.updatedAt, {
      resourceType: tombstone.resourceType,
      resourceId: tombstone.resourceId,
      parentResourceId: tombstone.parentResourceId,
      title: tombstone.title,
      deletedAt: tombstone.deletedAt.toISOString(),
      updatedAt: tombstone.updatedAt.toISOString(),
    }));
  }

  const cursor = cursorResult.data;
  const sortedEntries = entries.sort(compareNativeSyncEntries);
  const matchingEntries = sortedEntries.filter((entry) => entryIsAfterCursor(entry, cursor));
  const pageEntries = matchingEntries.slice(0, limitResult.data);
  const generatedAt = new Date().toISOString();

  return success({
    freshness: {
      accountId: user.id,
      environment: options.environment ?? "local",
      schemaVersion: NATIVE_SYNC_SCHEMA_VERSION,
      sourceEndpoint: "/api/v1/me/sync",
      generatedAt,
      lastValidatedAt: generatedAt,
    },
    entries: pageEntries,
    nextCursor: pageEntries.length > 0
      ? nativeSyncCursorFor(pageEntries[pageEntries.length - 1]!)
      : cursor!.raw,
    hasMore: matchingEntries.length > pageEntries.length,
  });
}
