-- Meal plan (app/domains/planning): each cook's plan of the week, one plan per cook until households
-- arrive and set householdId. An entry is a recipe at a servings scale, or a note, on a calendar day
-- ("YYYY-MM-DD" in the plan's time zone) and a meal type. A deleted recipe leaves its entry readable
-- through recipeTitle; sourceSystem and sourceId let a move-in add each source row once.
--
-- Reversible: nothing but the meal planner uses these tables, so rolling back is
--   DROP TABLE "PlanEntry"; DROP TABLE "MealPlan";
-- and the previous Worker never names them.
CREATE TABLE "MealPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "householdId" TEXT,
    "firstDayOfWeek" INTEGER NOT NULL DEFAULT 1,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MealPlan_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MealPlan_ownerId_key" ON "MealPlan"("ownerId");
CREATE INDEX "MealPlan_householdId_idx" ON "MealPlan"("householdId");

CREATE TABLE "PlanEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mealPlanId" TEXT NOT NULL,
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
    CONSTRAINT "PlanEntry_mealPlanId_fkey" FOREIGN KEY ("mealPlanId") REFERENCES "MealPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlanEntry_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PlanEntry_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PlanEntry_mealPlanId_sourceSystem_sourceId_key" ON "PlanEntry"("mealPlanId", "sourceSystem", "sourceId");
CREATE INDEX "PlanEntry_mealPlanId_date_mealType_position_idx" ON "PlanEntry"("mealPlanId", "date", "mealType", "position");
CREATE INDEX "PlanEntry_recipeId_idx" ON "PlanEntry"("recipeId");
