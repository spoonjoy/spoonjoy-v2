import type { PrismaClient } from "@prisma/client";

interface CompatibleD1PreparedStatement {
  bind(...values: unknown[]): CompatibleD1PreparedStatement;
}

interface CompatibleD1Result {
  meta?: { changes?: number };
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

function requiredD1Changes(results: CompatibleD1Result[]): number {
  const changes = results[0]?.meta?.changes;
  if (typeof changes !== "number") {
    throw new Error("D1 cookbook batch did not report mutation changes");
  }
  return changes;
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

  if (input.nativeDatabase) {
    const storedAt = timestamp.toISOString();
    await input.nativeDatabase.batch([
      input.nativeDatabase.prepare(`
        INSERT INTO "Cookbook" ("id", "title", "authorId", "createdAt", "updatedAt")
        VALUES (?, ?, ?, ?, ?)
      `).bind(cookbookId, input.title, input.userId, storedAt, storedAt),
      input.nativeDatabase.prepare(`
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
    ]);
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
    await input.database.cookbook.update({
      where: { id: input.cookbookId },
      data: { updatedAt },
    });
    return false;
  }

  try {
    if (input.nativeDatabase) {
      const membershipId = crypto.randomUUID();
      const storedAt = updatedAt.toISOString();
      await input.nativeDatabase.batch([
        input.nativeDatabase.prepare(`
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
        input.nativeDatabase.prepare(`
          UPDATE "Cookbook" SET "updatedAt" = ? WHERE "id" = ?
        `).bind(storedAt, input.cookbookId),
      ]);
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
    await input.database.cookbook.update({
      where: { id: input.cookbookId },
      data: { updatedAt },
    });
    return false;
  }
}

export async function removeRecipeFromCookbook(
  input: RemoveCookbookMembershipInput,
): Promise<boolean> {
  const where = membershipDeleteWhere(input);
  const updatedAt = new Date();

  if (input.nativeDatabase) {
    const storedAt = updatedAt.toISOString();
    const condition = input.membershipId
      ? `"id" = ? AND "cookbookId" = ?`
      : `"cookbookId" = ? AND "recipeId" = ?`;
    const values = input.membershipId
      ? [input.membershipId, input.cookbookId]
      : [input.cookbookId, input.recipeId];
    const results = await input.nativeDatabase.batch([
      input.nativeDatabase.prepare(`
        DELETE FROM "RecipeInCookbook" WHERE ${condition}
      `).bind(...values),
      input.nativeDatabase.prepare(`
        UPDATE "Cookbook" SET "updatedAt" = ? WHERE "id" = ?
      `).bind(storedAt, input.cookbookId),
    ]);
    return requiredD1Changes(results) > 0;
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
  if (input.nativeDatabase) {
    const storedAt = deletedAt.toISOString();
    await input.nativeDatabase.batch([
      input.nativeDatabase.prepare(`
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
        crypto.randomUUID(),
        input.accountId,
        input.cookbookId,
        input.title,
        storedAt,
        storedAt,
        storedAt,
      ),
      input.nativeDatabase.prepare(`
        DELETE FROM "Cookbook" WHERE "id" = ?
      `).bind(input.cookbookId),
    ]);
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
