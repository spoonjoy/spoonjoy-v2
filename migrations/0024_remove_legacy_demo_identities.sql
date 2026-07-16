-- Remove fixed sample identities introduced by the historical seed migrations.
-- Target immutable fixture IDs only; similarly named user-created accounts are preserved.

-- Preserve real recipes that were forked from a fixture recipe.
UPDATE "Recipe"
SET "sourceRecipeId" = NULL
WHERE "sourceRecipeId" IN (
  SELECT "id" FROM "Recipe"
  WHERE "chefId" IN ('demo_user_001', 'user_demo', 'user_julia', 'user_marco', 'user_sarah')
);

-- Remove cross-account memberships before deleting fixture-owned recipes and cookbooks.
DELETE FROM "RecipeInCookbook"
WHERE "addedById" IN ('demo_user_001', 'user_demo', 'user_julia', 'user_marco', 'user_sarah')
   OR "recipeId" IN (
     SELECT "id" FROM "Recipe"
     WHERE "chefId" IN ('demo_user_001', 'user_demo', 'user_julia', 'user_marco', 'user_sarah')
   )
   OR "cookbookId" IN (
     SELECT "id" FROM "Cookbook"
     WHERE "authorId" IN ('demo_user_001', 'user_demo', 'user_julia', 'user_marco', 'user_sarah')
   );

-- Detach real content from fixture-owned cover and provenance records.
UPDATE "Recipe"
SET "activeCoverId" = NULL,
    "activeCoverVariant" = NULL
WHERE "activeCoverId" IN (
  SELECT "id" FROM "RecipeCover"
  WHERE "recipeId" IN (
    SELECT "id" FROM "Recipe"
    WHERE "chefId" IN ('demo_user_001', 'user_demo', 'user_julia', 'user_marco', 'user_sarah')
  )
);

UPDATE "RecipeCover"
SET "createdById" = NULL
WHERE "createdById" IN ('demo_user_001', 'user_demo', 'user_julia', 'user_marco', 'user_sarah')
  AND "recipeId" NOT IN (
    SELECT "id" FROM "Recipe"
    WHERE "chefId" IN ('demo_user_001', 'user_demo', 'user_julia', 'user_marco', 'user_sarah')
  );

DELETE FROM "SearchDocument"
WHERE "ownerId" IN ('demo_user_001', 'user_demo', 'user_julia', 'user_marco', 'user_sarah')
   OR "entityId" IN (
     SELECT "id" FROM "Recipe"
     WHERE "chefId" IN ('demo_user_001', 'user_demo', 'user_julia', 'user_marco', 'user_sarah')
   )
   OR "entityId" IN (
     SELECT "id" FROM "RecipeSpoon"
     WHERE "chefId" IN ('demo_user_001', 'user_demo', 'user_julia', 'user_marco', 'user_sarah')
   )
   OR "entityId" IN (
     SELECT "id" FROM "RecipeCover"
     WHERE "recipeId" IN (
       SELECT "id" FROM "Recipe"
       WHERE "chefId" IN ('demo_user_001', 'user_demo', 'user_julia', 'user_marco', 'user_sarah')
     )
   );

DELETE FROM "RecipeCover"
WHERE "recipeId" IN (
  SELECT "id" FROM "Recipe"
  WHERE "chefId" IN ('demo_user_001', 'user_demo', 'user_julia', 'user_marco', 'user_sarah')
);

DELETE FROM "RecipeSpoon"
WHERE "chefId" IN ('demo_user_001', 'user_demo', 'user_julia', 'user_marco', 'user_sarah')
   OR "recipeId" IN (
     SELECT "id" FROM "Recipe"
     WHERE "chefId" IN ('demo_user_001', 'user_demo', 'user_julia', 'user_marco', 'user_sarah')
   );

DELETE FROM "Cookbook"
WHERE "authorId" IN ('demo_user_001', 'user_demo', 'user_julia', 'user_marco', 'user_sarah');

DELETE FROM "Recipe"
WHERE "chefId" IN ('demo_user_001', 'user_demo', 'user_julia', 'user_marco', 'user_sarah');

DELETE FROM "AgentConnectionRequest"
WHERE "approvedById" IN ('demo_user_001', 'user_demo', 'user_julia', 'user_marco', 'user_sarah')
   OR "credentialId" IN (
     SELECT "id" FROM "ApiCredential"
     WHERE "userId" IN ('demo_user_001', 'user_demo', 'user_julia', 'user_marco', 'user_sarah')
   );

DELETE FROM "OAuth"
WHERE "userId" IN ('demo_user_001', 'user_demo', 'user_julia', 'user_marco', 'user_sarah');

DELETE FROM "UserCredential"
WHERE "userId" IN ('demo_user_001', 'user_demo', 'user_julia', 'user_marco', 'user_sarah');

DELETE FROM "User"
WHERE "id" IN ('demo_user_001', 'user_demo', 'user_julia', 'user_marco', 'user_sarah');

-- Search documents are rebuilt lazily; force the next rebuild after source deletion.
DELETE FROM "SearchIndexMetadata";
