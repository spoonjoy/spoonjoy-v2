-- Organizers (app/domains/kitchen/model/organizer.ts): the tags, categories and tools a cook sorts
-- recipes by. An organizer belongs to its cook (ownerId) until households set householdId; its slug
-- is unique per owner and kind. RecipeOrganizer puts a recipe on an organizer, once.
--
-- Reversible: nothing but the organizers code uses these tables, so rolling back is
--   DROP TABLE "RecipeOrganizer"; DROP TABLE "Organizer";
-- and the previous Worker never names them.
CREATE TABLE "Organizer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "householdId" TEXT,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Organizer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Organizer_ownerId_kind_slug_key" ON "Organizer"("ownerId", "kind", "slug");
CREATE INDEX "Organizer_householdId_idx" ON "Organizer"("householdId");

CREATE TABLE "RecipeOrganizer" (
    "recipeId" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("recipeId", "organizerId"),
    CONSTRAINT "RecipeOrganizer_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RecipeOrganizer_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "Organizer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "RecipeOrganizer_organizerId_idx" ON "RecipeOrganizer"("organizerId");
