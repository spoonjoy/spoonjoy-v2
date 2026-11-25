-- A planned meal records the servings scale already put on a shopping list (app/domains/planning/application/plan-to-list.ts),
-- so "Add N meals to the list" adds only the meals not yet on it, or only what a meal's scale grew by, after a reload or
-- on another device. 0 means not on a list yet, which is every existing meal: the plan offers them again once.
--
-- Additive. Reversible: only Planning names these columns, so rolling back is
--   ALTER TABLE "PlanEntry" DROP COLUMN "listedScale"; ALTER TABLE "HouseholdPlanEntry" DROP COLUMN "listedScale";
-- and the previous Worker never names them.
ALTER TABLE "PlanEntry" ADD COLUMN "listedScale" REAL NOT NULL DEFAULT 0;
ALTER TABLE "HouseholdPlanEntry" ADD COLUMN "listedScale" REAL NOT NULL DEFAULT 0;
