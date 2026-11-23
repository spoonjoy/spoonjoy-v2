-- Calendar feed links (app/domains/planning): one private link per meal plan, which a calendar app subscribes to.
-- Only the SHA-256 of the link's token is stored; the token is shown to the cook once. Making a new link replaces
-- the row, so the old link stops working.
--
-- Additive. Reversible: only the calendar feed code names this table, so rolling back is
--   DROP TABLE "CalendarFeed";
-- and the previous Worker never names it.
CREATE TABLE "CalendarFeed" (
    "mealPlanId" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CalendarFeed_mealPlanId_fkey" FOREIGN KEY ("mealPlanId") REFERENCES "MealPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CalendarFeed_tokenHash_key" ON "CalendarFeed"("tokenHash");
