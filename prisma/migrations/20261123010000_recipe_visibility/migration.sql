-- Recipe visibility: who may read a recipe, and the level new recipes start with (see migrations/0040_recipe_visibility.sql).
ALTER TABLE "Recipe" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'public';
ALTER TABLE "User" ADD COLUMN "defaultRecipeVisibility" TEXT NOT NULL DEFAULT 'public';
