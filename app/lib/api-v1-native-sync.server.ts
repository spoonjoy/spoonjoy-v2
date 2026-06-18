import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "~/lib/account-settings.server";
import type { ApiV1ErrorCode } from "~/lib/api-v1-contract.server";

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

const NATIVE_SYNC_KIND_RANK = new Map(
  NATIVE_SYNC_KIND_ORDER.map((kind, index) => [kind, index]),
);

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
  return typeof value === "string" && NATIVE_SYNC_KIND_RANK.has(value as NativeSyncKind)
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
  const kindDelta = (NATIVE_SYNC_KIND_RANK.get(a.kind) ?? 0) - (NATIVE_SYNC_KIND_RANK.get(b.kind) ?? 0);
  if (kindDelta !== 0) return kindDelta;
  return a.resourceId.localeCompare(b.resourceId);
}

function entryIsAfterCursor(entry: NativeSyncEntry, cursor: NativeSyncCursor | null): boolean {
  if (!cursor) return true;
  const updatedAt = new Date(entry.updatedAt).getTime();
  const cursorUpdatedAt = cursor.updatedAt.getTime();
  if (updatedAt > cursorUpdatedAt) return true;
  if (updatedAt < cursorUpdatedAt || cursor.kind === null || cursor.resourceId === null) return false;
  const entryRank = NATIVE_SYNC_KIND_RANK.get(entry.kind) ?? 0;
  const cursorRank = NATIVE_SYNC_KIND_RANK.get(cursor.kind) ?? 0;
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

function parseCookbookTombstonePayload(payload: string | null): { title: string | null; deletedAt: string | null } {
  if (!payload) return { title: null, deletedAt: null };
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { title: null, deletedAt: null };
    }
    const title = (parsed as { title?: unknown }).title;
    const deletedAt = (parsed as { deletedAt?: unknown }).deletedAt;
    return {
      title: typeof title === "string" ? title : null,
      deletedAt: typeof deletedAt === "string" && strictIsoDate(deletedAt) ? deletedAt : null,
    };
  } catch {
    return { title: null, deletedAt: null };
  }
}

function recipeTombstone(recipe: {
  id: string;
  title: string;
  deletedAt: Date | null;
  updatedAt: Date;
}): NativeSyncTombstone {
  return {
    resourceType: "recipe",
    resourceId: recipe.id,
    parentResourceId: null,
    title: recipe.title,
    deletedAt: (recipe.deletedAt ?? recipe.updatedAt).toISOString(),
    updatedAt: recipe.updatedAt.toISOString(),
  };
}

function spoonTombstone(spoon: {
  id: string;
  recipeId: string;
  deletedAt: Date | null;
  updatedAt: Date;
}): NativeSyncTombstone {
  return {
    resourceType: "spoon",
    resourceId: spoon.id,
    parentResourceId: spoon.recipeId,
    title: null,
    deletedAt: (spoon.deletedAt ?? spoon.updatedAt).toISOString(),
    updatedAt: spoon.updatedAt.toISOString(),
  };
}

function shoppingItemTombstone(item: {
  id: string;
  shoppingListId: string;
  deletedAt: Date | null;
  updatedAt: Date;
}): NativeSyncTombstone {
  return {
    resourceType: "shoppingItem",
    resourceId: item.id,
    parentResourceId: item.shoppingListId,
    title: null,
    deletedAt: (item.deletedAt ?? item.updatedAt).toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function recipePayload(recipe: Awaited<ReturnType<typeof loadNativeSyncRecipes>>[number]) {
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    servings: recipe.servings,
    chef: {
      id: recipe.chef.id,
      username: recipe.chef.username,
    },
    sourceUrl: recipe.sourceUrl,
    deletedAt: null,
    createdAt: recipe.createdAt.toISOString(),
    updatedAt: recipe.updatedAt.toISOString(),
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
    })),
  };
}

function cookbookPayload(cookbook: Awaited<ReturnType<typeof loadNativeSyncCookbooks>>[number]) {
  return {
    id: cookbook.id,
    title: cookbook.title,
    author: {
      id: cookbook.author.id,
      username: cookbook.author.username,
    },
    deletedAt: null,
    createdAt: cookbook.createdAt.toISOString(),
    updatedAt: cookbook.updatedAt.toISOString(),
    recipes: cookbook.recipes
      .filter((entry) => !entry.recipe.deletedAt)
      .map((entry) => ({
        id: entry.recipe.id,
        title: entry.recipe.title,
        description: entry.recipe.description,
        servings: entry.recipe.servings,
        createdAt: entry.recipe.createdAt.toISOString(),
        updatedAt: entry.recipe.updatedAt.toISOString(),
      })),
  };
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
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      chef: { select: { id: true, username: true } },
      steps: {
        select: {
          id: true,
          stepNum: true,
          stepTitle: true,
          description: true,
          duration: true,
          ingredients: {
            select: {
              id: true,
              quantity: true,
              unit: { select: { name: true } },
              ingredientRef: { select: { name: true } },
            },
          },
          usingSteps: {
            select: {
              id: true,
              inputStepNum: true,
              outputStepNum: true,
              outputOfStep: { select: { stepNum: true, stepTitle: true } },
            },
          },
        },
      },
      cookbooks: {
        select: {
          cookbook: { select: { id: true, title: true } },
        },
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
              deletedAt: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
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
  return db.apiMutationTombstone.findMany({
    where: {
      resourceType: "cookbook",
      idempotencyKey: { userId },
    },
    select: {
      resourceType: true,
      resourceId: true,
      parentResourceId: true,
      payload: true,
      createdAt: true,
    },
  });
}

export async function loadNativeSyncSnapshot(
  db: Database,
  userId: string,
  url: URL,
  options: { environment?: string } = {},
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

  for (const recipe of recipes) {
    if (recipe.deletedAt) {
      entries.push(deleteEntry("recipe", recipe.id, recipe.updatedAt, recipeTombstone(recipe)));
      continue;
    }
    entries.push(upsertEntry("recipe", recipe.id, recipe.updatedAt, recipePayload(recipe)));
  }

  for (const cookbook of cookbooks) {
    entries.push(upsertEntry("cookbook", cookbook.id, cookbook.updatedAt, cookbookPayload(cookbook)));
  }

  for (const spoon of spoons) {
    if (spoon.deletedAt) {
      entries.push(deleteEntry("spoon", spoon.id, spoon.updatedAt, spoonTombstone(spoon)));
      continue;
    }
    entries.push(upsertEntry("spoon", spoon.id, spoon.updatedAt, spoonPayload(spoon)));
  }

  for (const item of shoppingItems) {
    if (item.deletedAt) {
      entries.push(deleteEntry("shoppingItem", item.id, item.updatedAt, shoppingItemTombstone(item)));
      continue;
    }
    entries.push(upsertEntry("shoppingItem", item.id, item.updatedAt, shoppingItemPayload(item)));
  }

  for (const tombstone of cookbookTombstones) {
    const parsedPayload = parseCookbookTombstonePayload(tombstone.payload);
    const deletedAt = parsedPayload.deletedAt ?? tombstone.createdAt.toISOString();
    entries.push(deleteEntry("cookbook", tombstone.resourceId, tombstone.createdAt, {
      resourceType: tombstone.resourceType,
      resourceId: tombstone.resourceId,
      parentResourceId: tombstone.parentResourceId,
      title: parsedPayload.title,
      deletedAt,
      updatedAt: tombstone.createdAt.toISOString(),
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
      : cursor?.raw ?? nativeSyncCursorFor(sortedEntries[sortedEntries.length - 1]!),
    hasMore: matchingEntries.length > pageEntries.length,
  });
}
