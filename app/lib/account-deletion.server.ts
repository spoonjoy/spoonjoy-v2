import type { D1Query, D1ReadDatabase } from "~/lib/d1-read.server";
import { d1Guard, d1Timestamp, d1WriteBatch, isD1GuardFailure } from "~/lib/d1-write.server";
import { photoCleanupRequestStatement } from "~/lib/photo-lifecycle.server";
import { DELETED_CHEF_USERNAME } from "~/lib/username";

// Deleting an account removes the person's data and keeps what other cooks built on it.
//
// The rule for recipes (docs/account-deletion.md):
// - A recipe another cook has engaged with stays public, attributed to the "deleted chef"
//   account instead of the person: another cook forked it, saved it in one of their cookbooks,
//   or logged a cook (a spoon) of it. Forks always stay their forker's; they keep pointing at
//   the recipe they came from.
// - Every other recipe of the person is deleted, with its steps, ingredients and covers.
//
// Everything else the person owns is deleted: their cookbooks and shopping list, their spoons
// on any recipe (and covers made from those spoons' photos, wherever they were copied), their
// profile photo, passkeys, sign-in links, API tokens, OAuth grants and tokens, push
// subscriptions and devices, notifications to them, and notifications to others that name them.
// Their photos are queued for the photo sweep, which removes each one once nothing references it.
//
// All of it is one atomic D1 batch: every statement applies, or none does.

/** The account that keeps the engaged recipes of deleted accounts. Nobody can sign in to it. */
export const DELETED_CHEF_ID = "deleted-chef";
export { DELETED_CHEF_USERNAME };
const DELETED_CHEF_EMAIL = "deleted-chef@spoonjoy.invalid";

export interface AccountDeletionResult {
  /** Recipes now kept by the deleted-chef account. */
  reassignedRecipes: number;
  /** Recipes deleted with the account. */
  deletedRecipes: number;
}

export class AccountDeletionError extends Error {
  constructor(
    readonly code: "account_not_found" | "account_not_deletable",
    message: string,
  ) {
    super(message);
    this.name = "AccountDeletionError";
  }
}

// A recipe of the account (`r`, whose "chefId" is bound first) that another cook engaged with.
// Bound values: the account id three times. The UPDATE that uses it sees the table as it was when
// the statement started, so a chain of the account's own forks is judged by their original owner.
const ENGAGED_BY_ANOTHER_COOK = `(
  EXISTS (SELECT 1 FROM "Recipe" AS "fork" WHERE "fork"."sourceRecipeId" = "r"."id" AND "fork"."chefId" != ?)
  OR EXISTS (
    SELECT 1 FROM "RecipeInCookbook" AS "saved"
    JOIN "Cookbook" AS "cookbook" ON "cookbook"."id" = "saved"."cookbookId"
    WHERE "saved"."recipeId" = "r"."id" AND "cookbook"."authorId" != ?
  )
  OR EXISTS (
    SELECT 1 FROM "RecipeSpoon" AS "spoon"
    WHERE "spoon"."recipeId" = "r"."id" AND "spoon"."chefId" != ? AND "spoon"."deletedAt" IS NULL
  )
)`;

// Live covers that show a photo from one of the account's spoons: made from the spoon, or copied
// (by a fork) or stylized from its photo. Bound values: the account id three times.
const COVERS_FROM_ACCOUNT_SPOONS = `SELECT "id" FROM "RecipeCover"
  WHERE "status" != 'archived' AND "archivedAt" IS NULL AND (
    "sourceSpoonId" IN (SELECT "id" FROM "RecipeSpoon" WHERE "chefId" = ?)
    OR "imageUrl" IN (SELECT "photoUrl" FROM "RecipeSpoon" WHERE "chefId" = ? AND "photoUrl" IS NOT NULL)
    OR "sourceImageUrl" IN (SELECT "photoUrl" FROM "RecipeSpoon" WHERE "chefId" = ? AND "photoUrl" IS NOT NULL)
  )`;

// Every stored photo URL the account owns or shows on its own recipes. Bound: the account id 4 times.
const ACCOUNT_PHOTO_URLS = `SELECT "photoUrl" AS "url" FROM "User" WHERE "id" = ?
  UNION SELECT "photoUrl" FROM "RecipeSpoon" WHERE "chefId" = ?
  UNION SELECT "imageUrl" FROM "RecipeCover" WHERE "recipeId" IN (SELECT "id" FROM "Recipe" WHERE "chefId" = ?)
  UNION SELECT "stylizedImageUrl" FROM "RecipeCover" WHERE "recipeId" IN (SELECT "id" FROM "Recipe" WHERE "chefId" = ?)
  UNION SELECT "sourceImageUrl" FROM "RecipeCover" WHERE "recipeId" IN (SELECT "id" FROM "Recipe" WHERE "chefId" = ?)`;

const ACCOUNT_GRANTS = `SELECT "id" FROM "OAuthGrant" WHERE "userId" = ?`;
const ACCOUNT_REFRESH_TOKENS = `SELECT "id" FROM "OAuthRefreshToken" WHERE "userId" = ?`;
const ACCOUNT_CREDENTIALS = `SELECT "id" FROM "ApiCredential" WHERE "userId" = ?`;
const ACCOUNT_AUTH_CODES = `SELECT "id" FROM "OAuthAuthCode" WHERE "userId" = ?`;

/**
 * The statements that delete account `userId` at `now`, in
 * order. The statements at REASSIGN_STATEMENT and DELETE_RECIPES_STATEMENT reassign the engaged
 * recipes and delete the rest; their change counts are the result's counts.
 */
export function accountDeletionStatements(userId: string, now: Date): D1Query[] {
  const at = d1Timestamp(now);
  const id = userId;
  return [
    // The account still exists and is not the deleted-chef account.
    d1Guard(`EXISTS (SELECT 1 FROM "User" WHERE "id" = ?) AND ? != ?`, id, id, DELETED_CHEF_ID),
    // Queue the account's photos for the sweep, before the rows that name them go.
    photoCleanupRequestStatement(ACCOUNT_PHOTO_URLS, [id, id, id, id, id], "account_deleted", now, now),
    // The deleted-chef account, the first time it is needed.
    [
      `INSERT OR IGNORE INTO "User" ("id", "email", "username", "createdAt", "updatedAt", "sessionVersion")
       VALUES (?, ?, ?, ?, ?, 0)`,
      DELETED_CHEF_ID,
      DELETED_CHEF_EMAIL,
      DELETED_CHEF_USERNAME,
      at,
      at,
    ],
    // Engaged recipes move to the deleted-chef account.
    [
      `UPDATE "Recipe" AS "r" SET "chefId" = ?, "updatedAt" = ? WHERE "r"."chefId" = ? AND ${ENGAGED_BY_ANOTHER_COOK}`,
      DELETED_CHEF_ID,
      at,
      id,
      id,
      id,
      id,
    ],
    // Covers made from the account's spoon photos are archived, and are no longer any
    // Recipe's active cover.
    [
      `UPDATE "Recipe" SET "activeCoverId" = NULL, "activeCoverVariant" = NULL, "coverMode" = 'none', "updatedAt" = ?
       WHERE "activeCoverId" IN (${COVERS_FROM_ACCOUNT_SPOONS})`,
      at,
      id,
      id,
      id,
    ],
    [
      `UPDATE "RecipeCover" SET "status" = 'archived', "archivedAt" = ? WHERE "id" IN (${COVERS_FROM_ACCOUNT_SPOONS})`,
      at,
      id,
      id,
      id,
    ],
    // No cover names the account as its creator any more.
    [`UPDATE "RecipeCover" SET "createdById" = NULL WHERE "createdById" = ?`, id],
    // Recipes that came from a recipe about to be deleted (the account's own forks of its own
    // Recipes) stop pointing at it, and saves of those recipes, and every save the account made,
    // Are removed.
    [
      `UPDATE "Recipe" SET "sourceRecipeId" = NULL, "updatedAt" = ?
       WHERE "sourceRecipeId" IN (SELECT "id" FROM "Recipe" WHERE "chefId" = ?)`,
      at,
      id,
    ],
    [
      `DELETE FROM "RecipeInCookbook"
       WHERE "addedById" = ?
         OR "recipeId" IN (SELECT "id" FROM "Recipe" WHERE "chefId" = ?)
         OR "cookbookId" IN (SELECT "id" FROM "Cookbook" WHERE "authorId" = ?)`,
      id,
      id,
      id,
    ],
    // Cookbooks that hold a reassigned recipe are touched, so native clients re-read its chef.
    [
      `UPDATE "Cookbook" SET "updatedAt" = ? WHERE "id" IN (
         SELECT "cookbookId" FROM "RecipeInCookbook"
         WHERE "recipeId" IN (SELECT "id" FROM "Recipe" WHERE "chefId" = ? AND "updatedAt" = ?)
       )`,
      at,
      DELETED_CHEF_ID,
      at,
    ],
    // The account's other recipes (steps, ingredients, covers and spoons cascade).
    [`DELETE FROM "Recipe" WHERE "chefId" = ?`, id],
    // OAuth issuance history first: it references grants, tokens and codes with NO ACTION keys.
    [
      `DELETE FROM "OAuthRefreshLineage"
       WHERE "grantId" IN (${ACCOUNT_GRANTS}) OR "refreshTokenId" IN (${ACCOUNT_REFRESH_TOKENS})`,
      id,
      id,
    ],
    [
      `DELETE FROM "OAuthTokenIssuance"
       WHERE "grantId" IN (${ACCOUNT_GRANTS})
         OR "accessCredentialId" IN (${ACCOUNT_CREDENTIALS})
         OR "refreshTokenId" IN (${ACCOUNT_REFRESH_TOKENS})
         OR "parentRefreshTokenId" IN (${ACCOUNT_REFRESH_TOKENS})
         OR "authorizationCodeId" IN (${ACCOUNT_AUTH_CODES})`,
      id,
      id,
      id,
      id,
      id,
    ],
    // Every way to act as the account: tokens, grants, codes, passkeys and sign-in links. An
    // Approved agent connection that was never claimed can no longer be.
    [`DELETE FROM "OAuthRefreshToken" WHERE "userId" = ?`, id],
    [`DELETE FROM "OAuthAuthCode" WHERE "userId" = ?`, id],
    [`DELETE FROM "OAuthConsentTransaction" WHERE "userId" = ?`, id],
    [`DELETE FROM "OAuthGrant" WHERE "userId" = ?`, id],
    [`DELETE FROM "AgentConnectionRequest" WHERE "approvedById" = ?`, id],
    [`DELETE FROM "ApiCredential" WHERE "userId" = ?`, id],
    [`DELETE FROM "UserCredential" WHERE "userId" = ?`, id],
    [`DELETE FROM "OAuth" WHERE "userId" = ?`, id],
    // Notifications to other cooks that name the account.
    [
      `DELETE FROM "NotificationEvent"
       WHERE json_valid("payload")
         AND (SELECT "username" FROM "User" WHERE "id" = ?) IN (
           json_extract("payload", '$.spoonerUsername'),
           json_extract("payload", '$.forkerUsername'),
           json_extract("payload", '$.actorUsername')
         )`,
      id,
    ],
    // The account. Its cookbooks, shopping list, spoons, push subscriptions and devices,
    // Notifications, preferences, idempotency keys and sync tombstones cascade.
    [`DELETE FROM "User" WHERE "id" = ?`, id],
  ];
}

export const REASSIGN_STATEMENT = 3;
export const DELETE_RECIPES_STATEMENT = 10;

/**
 * Deletes account `userId` as one atomic D1 batch. Throws `AccountDeletionError` when the
 * account does not exist or is the deleted-chef account.
 */
export async function deleteAccount(
  d1: D1ReadDatabase,
  userId: string,
  options: { now?: Date } = {},
): Promise<AccountDeletionResult> {
  if (userId === DELETED_CHEF_ID) {
    throw new AccountDeletionError("account_not_deletable", "This account can't be deleted.");
  }
  try {
    const results = await d1WriteBatch(d1, accountDeletionStatements(userId, options.now ?? new Date()));
    return {
      reassignedRecipes: results[REASSIGN_STATEMENT].changes,
      deletedRecipes: results[DELETE_RECIPES_STATEMENT].changes,
    };
  } catch (error) {
    // The account does not exist, or was deleted by another request first.
    if (isD1GuardFailure(error)) throw new AccountDeletionError("account_not_found", "Account not found.");
    throw error;
  }
}
