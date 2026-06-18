import { getLocalDb } from "~/lib/db.server";

/**
 * Clean up all test data in the correct order to respect foreign key constraints.
 * Call this in afterEach hooks.
 */
export async function cleanupDatabase() {
  const db = await getLocalDb();
  
  // Enable foreign keys for proper cascading
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON;');

  // Delete data in order from most dependent to least dependent
  // Things that reference other things must be deleted first
  await db.$executeRawUnsafe(`CREATE VIRTUAL TABLE IF NOT EXISTS "SearchDocument" USING fts5(
    entityType UNINDEXED,
    entityId UNINDEXED,
    ownerId UNINDEXED,
    ownerUsername UNINDEXED,
    sortAt UNINDEXED,
    title,
    subtitle,
    body,
    href UNINDEXED,
    imageUrl UNINDEXED,
    metadata UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2',
    prefix = '2 3 4'
  );`);
  await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SearchIndexMetadata" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceFingerprint" TEXT NOT NULL,
    "documentCount" INTEGER NOT NULL DEFAULT 0,
    "rebuiltAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);
  await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ApiMutationTombstone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "idempotencyKeyId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "parentResourceId" TEXT,
    "payload" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiMutationTombstone_idempotencyKeyId_fkey" FOREIGN KEY ("idempotencyKeyId") REFERENCES "ApiIdempotencyKey" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );`);
  await db.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "ApiMutationTombstone_idempotencyKeyId_resourceType_resourceId_key" ON "ApiMutationTombstone"("idempotencyKeyId", "resourceType", "resourceId");');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "ApiMutationTombstone_idempotencyKeyId_idx" ON "ApiMutationTombstone"("idempotencyKeyId");');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "ApiMutationTombstone_resourceType_resourceId_idx" ON "ApiMutationTombstone"("resourceType", "resourceId");');
  await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "NativeSyncTombstone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "parentResourceId" TEXT,
    "title" TEXT,
    "deletedAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NativeSyncTombstone_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );`);
  await db.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "NativeSyncTombstone_userId_resourceType_resourceId_key" ON "NativeSyncTombstone"("userId", "resourceType", "resourceId");');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "NativeSyncTombstone_userId_updatedAt_idx" ON "NativeSyncTombstone"("userId", "updatedAt");');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "NativeSyncTombstone_resourceType_resourceId_idx" ON "NativeSyncTombstone"("resourceType", "resourceId");');
  await db.$executeRawUnsafe('DELETE FROM "SearchDocument";');
  await db.$executeRawUnsafe('DELETE FROM "SearchIndexMetadata";');

  await db.shoppingListItem.deleteMany({});
  await db.shoppingList.deleteMany({});
  await db.stepOutputUse.deleteMany({});
  await db.ingredient.deleteMany({});
  await db.recipeStep.deleteMany({});
  await db.recipeInCookbook.deleteMany({});
  await db.cookbook.deleteMany({});
  // Clear fork attribution before deleting recipes (Recipe.sourceRecipe uses onDelete: Restrict).
  await db.recipe.updateMany({ data: { sourceRecipeId: null } });
  await db.recipe.deleteMany({});
  await db.ingredientRef.deleteMany({});
  await db.unit.deleteMany({});
  await db.agentConnectionRequest.deleteMany({});
  await db.apiMutationTombstone.deleteMany({});
  await db.apiIdempotencyKey.deleteMany({});
  await db.nativeSyncTombstone.deleteMany({});
  await db.apiCredential.deleteMany({});
  await db.nativePushDevice.deleteMany({});
  await db.oAuthAuthCode.deleteMany({});
  await db.oAuthRefreshToken.deleteMany({});
  await db.oAuthClient.deleteMany({});
  await db.userCredential.deleteMany({});
  await db.oAuth.deleteMany({});
  await db.user.deleteMany({});
}
