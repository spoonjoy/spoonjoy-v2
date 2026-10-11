import type { PrismaClient } from "@prisma/client";
import { retryD1Write } from "~/lib/d1-write-retry.server";

// Cookbook writes shared by the cookbook page, the recipe page's Prisma path, API v1 and the
// tools API. With the D1 binding each write is one batch, and each runs again after a transient
// D1 error (retryD1Write) only where that is safe: a new cookbook or membership has its id chosen
// before the first try, and after an ambiguous failure a read by that id says whether the earlier
// try committed; a removal touches the cookbook at a time chosen once, which says the same; a
// delete and a touch set fixed values. The Prisma branches run only without a binding.

interface CompatibleD1PreparedStatement {
  bind(...values: unknown[]): CompatibleD1PreparedStatement;
}

interface CompatibleD1Result {
  meta?: { changes?: number };
  results?: unknown[];
}

export interface CompatibleCookbookD1Database {
  prepare(query: string): CompatibleD1PreparedStatement;
  batch(statements: CompatibleD1PreparedStatement[]): Promise<CompatibleD1Result[]>;
}

interface CookbookMutationContext {
  database: PrismaClient;
  nativeDatabase: CompatibleCookbookD1Database | null;
}

interface CookbookMembershipInput extends CookbookMutationContext {
  cookbookId: string;
  recipeId: string;
  userId: string;
}

interface RemoveCookbookMembershipInput extends CookbookMutationContext {
  cookbookId: string;
  recipeId?: string;
  membershipId?: string;
}

interface DeleteCookbookInput extends CookbookMutationContext {
  accountId: string;
  cookbookId: string;
  title: string;
}

export function asCompatibleCookbookD1Database(
  value: unknown,
): CompatibleCookbookD1Database | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CompatibleCookbookD1Database>;
  return typeof candidate.prepare === "function" && typeof candidate.batch === "function"
    ? candidate as CompatibleCookbookD1Database
    : null;
}

function isCookbookMembershipUniqueConflict(error: unknown): boolean {
  if (error && typeof error === "object") {
    const candidate = error as {
      code?: unknown;
      meta?: { target?: unknown } | null;
      message?: unknown;
    };
    const target = candidate.meta?.target;
    if (
      candidate.code === "P2002" &&
      Array.isArray(target) &&
      target.length === 2 &&
      target[0] === "cookbookId" &&
      target[1] === "recipeId"
    ) {
      return true;
    }
    return typeof candidate.message === "string" &&
      /UNIQUE constraint failed: RecipeInCookbook\.cookbookId, RecipeInCookbook\.recipeId(?![A-Za-z0-9_.]|\s*,)/.test(candidate.message);
  }
  return false;
}

// A cookbook title the author already uses (the Cookbook (authorId, title) unique index), from
// local Prisma (P2002 on those fields) or from native D1 (SQLite's constraint message).
export function isCookbookTitleUniqueConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    meta?: { target?: unknown } | null;
    message?: unknown;
  };
  const target = candidate.meta?.target;
  if (
    candidate.code === "P2002" &&
    Array.isArray(target) &&
    target.length === 2 &&
    target[0] === "authorId" &&
    target[1] === "title"
  ) {
    return true;
  }
  return typeof candidate.message === "string" &&
    /UNIQUE constraint failed: Cookbook\.authorId, Cookbook\.title(?![A-Za-z0-9_.]|\s*,)/.test(candidate.message);
}

function requiredD1Changes(results: CompatibleD1Result[], index: number): number {
  const changes = results[index]?.meta?.changes;
  if (typeof changes !== "number") {
    throw new Error("D1 cookbook batch did not report mutation changes");
  }
  return changes;
}

/** Whether a read on the binding finds any row. */
async function nativeRowExists(
  nativeDatabase: CompatibleCookbookD1Database,
  sql: string,
  ...values: unknown[]
): Promise<true | null> {
  const [result] = await nativeDatabase.batch([nativeDatabase.prepare(sql).bind(...values)]);
  return (result?.results?.length ?? 0) > 0 ? true : null;
}

/** Sets the cookbook's last change: a fixed value, so it simply runs again after a transient error. */
async function touchCookbook(database: PrismaClient, cookbookId: string, updatedAt: Date): Promise<void> {
  await retryD1Write({ scope: "cookbook.touch" }, () => database.cookbook.update({
    where: { id: cookbookId },
    data: { updatedAt },
  }));
}

function membershipDeleteWhere(input: RemoveCookbookMembershipInput) {
  if (input.membershipId) {
    return { id: input.membershipId, cookbookId: input.cookbookId };
  }
  if (input.recipeId) {
    return { cookbookId: input.cookbookId, recipeId: input.recipeId };
  }
  throw new Error("A cookbook membership id or recipe id is required");
}

export async function createCookbookWithRecipe(
  input: CookbookMutationContext & {
    title: string;
    userId: string;
    recipeId: string;
  },
): Promise<{ id: string; title: string }> {
  const cookbookId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  const timestamp = new Date();

  const nativeDatabase = input.nativeDatabase;
  if (nativeDatabase) {
    const storedAt = timestamp.toISOString();
    // A retry after a late commit fails on the title the earlier try took; the read by the
    // cookbook's id finds that try's cookbook (with its membership: the batch is atomic).
    await retryD1Write(
      {
        scope: "cookbook.create_with_recipe.compat",
        applied: () => nativeRowExists(
          nativeDatabase,
          `SELECT 1 AS "made" FROM "Cookbook" WHERE "id" = ? AND "authorId" = ?`,
          cookbookId,
          input.userId,
        ),
      },
      () => nativeDatabase.batch([
        nativeDatabase.prepare(`
          INSERT INTO "Cookbook" ("id", "title", "authorId", "createdAt", "updatedAt")
          VALUES (?, ?, ?, ?, ?)
        `).bind(cookbookId, input.title, input.userId, storedAt, storedAt),
        nativeDatabase.prepare(`
          INSERT INTO "RecipeInCookbook" (
            "id", "cookbookId", "recipeId", "addedById", "createdAt", "updatedAt"
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          membershipId,
          cookbookId,
          input.recipeId,
          input.userId,
          storedAt,
          storedAt,
        ),
      ]).then(() => true as const),
    );
  } else {
    await input.database.$transaction(async (transaction) => {
      await transaction.cookbook.create({
        data: {
          id: cookbookId,
          title: input.title,
          authorId: input.userId,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      });
      await transaction.recipeInCookbook.create({
        data: {
          id: membershipId,
          cookbookId,
          recipeId: input.recipeId,
          addedById: input.userId,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      });
    });
  }

  return { id: cookbookId, title: input.title };
}

export async function addRecipeToCookbook(
  input: CookbookMembershipInput,
): Promise<boolean> {
  const existing = await input.database.recipeInCookbook.findUnique({
    where: {
      cookbookId_recipeId: {
        cookbookId: input.cookbookId,
        recipeId: input.recipeId,
      },
    },
    select: { id: true },
  });
  const updatedAt = new Date();
  if (existing) {
    await touchCookbook(input.database, input.cookbookId, updatedAt);
    return false;
  }

  try {
    const nativeDatabase = input.nativeDatabase;
    if (nativeDatabase) {
      const membershipId = crypto.randomUUID();
      const storedAt = updatedAt.toISOString();
      // The membership's id is chosen before the first try. A retry after a late commit fails on
      // the membership that try wrote; the read by id says it was this request's, so it was added.
      await retryD1Write(
        {
          scope: "cookbook.add_recipe.compat",
          applied: () => nativeRowExists(
            nativeDatabase,
            `SELECT 1 AS "added" FROM "RecipeInCookbook" WHERE "id" = ?`,
            membershipId,
          ),
        },
        () => nativeDatabase.batch([
          nativeDatabase.prepare(`
            INSERT INTO "RecipeInCookbook" (
              "id", "cookbookId", "recipeId", "addedById", "createdAt", "updatedAt"
            ) VALUES (?, ?, ?, ?, ?, ?)
          `).bind(
            membershipId,
            input.cookbookId,
            input.recipeId,
            input.userId,
            storedAt,
            storedAt,
          ),
          nativeDatabase.prepare(`
            UPDATE "Cookbook" SET "updatedAt" = ? WHERE "id" = ?
          `).bind(storedAt, input.cookbookId),
        ]).then(() => true as const),
      );
    } else {
      await input.database.$transaction(async (transaction) => {
        await transaction.recipeInCookbook.create({
          data: {
            cookbookId: input.cookbookId,
            recipeId: input.recipeId,
            addedById: input.userId,
          },
        });
        await transaction.cookbook.update({
          where: { id: input.cookbookId },
          data: { updatedAt },
        });
      });
    }
    return true;
  } catch (error) {
    if (!isCookbookMembershipUniqueConflict(error)) throw error;
    await touchCookbook(input.database, input.cookbookId, updatedAt);
    return false;
  }
}

export async function removeRecipeFromCookbook(
  input: RemoveCookbookMembershipInput,
): Promise<boolean> {
  const where = membershipDeleteWhere(input);
  const updatedAt = new Date();

  const nativeDatabase = input.nativeDatabase;
  if (nativeDatabase) {
    const storedAt = updatedAt.toISOString();
    const condition = input.membershipId
      ? `"id" = ? AND "cookbookId" = ?`
      : `"cookbookId" = ? AND "recipeId" = ?`;
    const values = input.membershipId
      ? [input.membershipId, input.cookbookId]
      : [input.cookbookId, input.recipeId];
    // Whether there is a membership to remove is read before the first try. After an ambiguous
    // failure, the cookbook carrying this request's touch time says an earlier try committed, and
    // then it removed the membership if there was one. A later try that finds nothing to remove
    // answers the same way: its earlier try, landing late, removed it.
    const membershipSql = `SELECT 1 AS "present" FROM "RecipeInCookbook" WHERE ${condition}`;
    const present = (await nativeRowExists(nativeDatabase, membershipSql, ...values)) === true;
    let tries = 0;
    return retryD1Write(
      {
        scope: "cookbook.remove_recipe.compat",
        applied: async () => (await nativeRowExists(
          nativeDatabase,
          `SELECT 1 AS "touched" FROM "Cookbook" WHERE "id" = ? AND "updatedAt" = ?`,
          input.cookbookId,
          storedAt,
        )) ? present : null,
      },
      async () => {
        tries += 1;
        const results = await nativeDatabase.batch([
          nativeDatabase.prepare(`
            DELETE FROM "RecipeInCookbook" WHERE ${condition}
          `).bind(...values),
          nativeDatabase.prepare(`
            UPDATE "Cookbook" SET "updatedAt" = ? WHERE "id" = ?
          `).bind(storedAt, input.cookbookId),
        ]);
        return requiredD1Changes(results, 0) > 0 || (tries > 1 && present);
      },
    );
  }

  return input.database.$transaction(async (transaction) => {
    const deleted = await transaction.recipeInCookbook.deleteMany({ where });
    await transaction.cookbook.update({
      where: { id: input.cookbookId },
      data: { updatedAt },
    });
    return deleted.count > 0;
  });
}

export async function deleteCookbookWithTombstone(
  input: DeleteCookbookInput,
): Promise<void> {
  const deletedAt = new Date();
  const nativeDatabase = input.nativeDatabase;
  if (nativeDatabase) {
    const storedAt = deletedAt.toISOString();
    const tombstoneId = crypto.randomUUID();
    // The tombstone is an upsert by its natural key with fixed values and the delete is by id, so
    // running the batch again leaves the same rows.
    await retryD1Write({ scope: "cookbook.delete" }, () => nativeDatabase.batch([
      nativeDatabase.prepare(`
        INSERT INTO "NativeSyncTombstone" (
          "id", "accountId", "resourceType", "resourceId", "parentResourceId",
          "title", "deletedAt", "updatedAt", "createdAt"
        ) VALUES (?, ?, 'cookbook', ?, NULL, ?, ?, ?, ?)
        ON CONFLICT ("accountId", "resourceType", "resourceId") DO UPDATE SET
          "parentResourceId" = NULL,
          "title" = excluded."title",
          "deletedAt" = excluded."deletedAt",
          "updatedAt" = excluded."updatedAt"
      `).bind(
        tombstoneId,
        input.accountId,
        input.cookbookId,
        input.title,
        storedAt,
        storedAt,
        storedAt,
      ),
      nativeDatabase.prepare(`
        DELETE FROM "Cookbook" WHERE "id" = ?
      `).bind(input.cookbookId),
    ]));
    return;
  }

  await input.database.$transaction(async (transaction) => {
    await transaction.nativeSyncTombstone.upsert({
      where: {
        accountId_resourceType_resourceId: {
          accountId: input.accountId,
          resourceType: "cookbook",
          resourceId: input.cookbookId,
        },
      },
      update: {
        parentResourceId: null,
        title: input.title,
        deletedAt,
        updatedAt: deletedAt,
      },
      create: {
        accountId: input.accountId,
        resourceType: "cookbook",
        resourceId: input.cookbookId,
        parentResourceId: null,
        title: input.title,
        deletedAt,
        updatedAt: deletedAt,
      },
    });
    await transaction.cookbook.delete({ where: { id: input.cookbookId } });
  });
}
