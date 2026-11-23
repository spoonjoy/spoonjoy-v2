-- Plan rules (app/domains/planning): what a random pick may choose for a meal. A rule names a weekday (0 is Sunday),
-- a meal type, both or neither (null is any), and the organizers a recipe must all have, as a JSON array of ids.
--
-- Additive. Reversible: only the plan rules code names this table, so rolling back is
--   DROP TABLE "PlanRule";
-- and the previous Worker never names it.
CREATE TABLE "PlanRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mealPlanId" TEXT NOT NULL,
    "weekday" INTEGER,
    "mealType" TEXT,
    "organizerIds" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlanRule_mealPlanId_fkey" FOREIGN KEY ("mealPlanId") REFERENCES "MealPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PlanRule_mealPlanId_idx" ON "PlanRule"("mealPlanId");
