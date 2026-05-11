-- Section 1: create RecipeSpoon, RecipeCover, ImageGenLedger tables and their indexes.

CREATE TABLE IF NOT EXISTS "RecipeSpoon" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "chefId" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL,
  "cookedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "photoUrl" TEXT,
  "note" TEXT,
  "nextTime" TEXT,
  "deletedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecipeSpoon_chefId_fkey" FOREIGN KEY ("chefId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RecipeSpoon_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "RecipeSpoon_recipeId_cookedAt_idx" ON "RecipeSpoon"("recipeId", "cookedAt");
CREATE INDEX IF NOT EXISTS "RecipeSpoon_chefId_cookedAt_idx"  ON "RecipeSpoon"("chefId", "cookedAt");

CREATE TABLE IF NOT EXISTS "RecipeCover" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "recipeId" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "stylizedImageUrl" TEXT,
  "sourceType" TEXT NOT NULL,
  "sourceSpoonId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecipeCover_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RecipeCover_sourceSpoonId_fkey" FOREIGN KEY ("sourceSpoonId") REFERENCES "RecipeSpoon" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "RecipeCover_recipeId_createdAt_idx" ON "RecipeCover"("recipeId", "createdAt");
CREATE INDEX IF NOT EXISTS "RecipeCover_sourceSpoonId_idx" ON "RecipeCover"("sourceSpoonId");

CREATE TABLE IF NOT EXISTS "ImageGenLedger" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "bucketStart" DATETIME NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImageGenLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ImageGenLedger_userId_kind_bucketStart_key" ON "ImageGenLedger"("userId","kind","bucketStart");
CREATE INDEX IF NOT EXISTS "ImageGenLedger_userId_bucketStart_idx" ON "ImageGenLedger"("userId","bucketStart");
