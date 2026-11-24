-- Household meal plan (app/domains/planning): one plan per household, kept beside the cooks' plans. A household plan
-- and its entries live in their own tables only because turning MealPlan.ownerId optional means rebuilding MealPlan,
-- which the automatic release can't apply and which would cascade-delete its entries, rules and feeds. Planning
-- keeps one model: its Prisma adapter picks the table by plan scope. When a reviewed path for non-additive migrations
-- exists, the two can be folded together. Each entry has the same columns as PlanEntry.
--
-- Additive. Reversible: only the meal planner names these tables, so rolling back is
--   DROP TABLE "HouseholdPlanEntry"; DROP TABLE "HouseholdPlan";
-- and the previous Worker never names them.
CREATE TABLE "HouseholdPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "firstDayOfWeek" INTEGER NOT NULL DEFAULT 1,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HouseholdPlan_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "HouseholdPlan_householdId_key" ON "HouseholdPlan"("householdId");

CREATE TABLE "HouseholdPlanEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdPlanId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "span" TEXT NOT NULL DEFAULT 'day',
    "mealType" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL,
    "recipeId" TEXT,
    "recipeTitle" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "scaleFactor" REAL NOT NULL DEFAULT 1,
    "addedById" TEXT,
    "cookedAt" DATETIME,
    "spoonId" TEXT,
    "sourceSystem" TEXT,
    "sourceId" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HouseholdPlanEntry_householdPlanId_fkey" FOREIGN KEY ("householdPlanId") REFERENCES "HouseholdPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HouseholdPlanEntry_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "HouseholdPlanEntry_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "HouseholdPlanEntry_householdPlanId_sourceSystem_sourceId_key" ON "HouseholdPlanEntry"("householdPlanId", "sourceSystem", "sourceId");
CREATE INDEX "HouseholdPlanEntry_householdPlanId_date_mealType_position_idx" ON "HouseholdPlanEntry"("householdPlanId", "date", "mealType", "position");
CREATE INDEX "HouseholdPlanEntry_recipeId_idx" ON "HouseholdPlanEntry"("recipeId");
