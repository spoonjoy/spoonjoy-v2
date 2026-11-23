-- Recipe visibility (app/domains/kitchen/model/recipe-visibility.ts): who may read a recipe, private, household or
-- public, and the level a cook's new recipes start with. Every recipe so far was readable by anyone, so both default
-- to public and nothing changes for existing recipes or cooks.
--
-- Additive. Reversible: only the recipe visibility code names these columns, so rolling back is
--   ALTER TABLE "User" DROP COLUMN "defaultRecipeVisibility";
--   ALTER TABLE "Recipe" DROP COLUMN "visibility";
-- and the previous Worker never names them.
ALTER TABLE "Recipe" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'public';
ALTER TABLE "User" ADD COLUMN "defaultRecipeVisibility" TEXT NOT NULL DEFAULT 'public';
