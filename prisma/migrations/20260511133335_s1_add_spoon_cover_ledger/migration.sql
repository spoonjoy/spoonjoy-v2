-- CreateTable
CREATE TABLE "RecipeSpoon" (
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

-- CreateTable
CREATE TABLE "RecipeCover" (
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

-- CreateTable
CREATE TABLE "ImageGenLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "bucketStart" DATETIME NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImageGenLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RecipeSpoon_recipeId_cookedAt_idx" ON "RecipeSpoon"("recipeId", "cookedAt");

-- CreateIndex
CREATE INDEX "RecipeSpoon_chefId_cookedAt_idx" ON "RecipeSpoon"("chefId", "cookedAt");

-- CreateIndex
CREATE INDEX "RecipeCover_recipeId_createdAt_idx" ON "RecipeCover"("recipeId", "createdAt");

-- CreateIndex
CREATE INDEX "RecipeCover_sourceSpoonId_idx" ON "RecipeCover"("sourceSpoonId");

-- CreateIndex
CREATE INDEX "ImageGenLedger_userId_bucketStart_idx" ON "ImageGenLedger"("userId", "bucketStart");

-- CreateIndex
CREATE UNIQUE INDEX "ImageGenLedger_userId_kind_bucketStart_key" ON "ImageGenLedger"("userId", "kind", "bucketStart");
