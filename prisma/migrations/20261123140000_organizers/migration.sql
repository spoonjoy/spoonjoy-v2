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
