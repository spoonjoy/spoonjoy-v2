PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

DELETE FROM "SearchDocument";
DELETE FROM "SearchIndexMetadata";
DELETE FROM "ApiMutationTombstone";
DELETE FROM "ApiIdempotencyKey";
DELETE FROM "AgentConnectionRequest";
DELETE FROM "OAuthAuthCode";
DELETE FROM "OAuthRefreshToken";
DELETE FROM "ApiCredential";
DELETE FROM "NativePushDevice";
DELETE FROM "NativeSyncTombstone";
DELETE FROM "NotificationEvent";
DELETE FROM "NotificationPreference";
DELETE FROM "PushSubscription";
DELETE FROM "ImageGenLedger";
DELETE FROM "RecipeCover";
DELETE FROM "RecipeSpoon";
DELETE FROM "StepOutputUse";
DELETE FROM "Ingredient";
DELETE FROM "RecipeStep";
DELETE FROM "ShoppingListItem";
DELETE FROM "ShoppingList";
DELETE FROM "RecipeInCookbook";
DELETE FROM "Cookbook";
UPDATE "Recipe" SET "sourceRecipeId" = NULL;
DELETE FROM "Recipe";
DELETE FROM "OAuth";
DELETE FROM "UserCredential";
DELETE FROM "User";

INSERT INTO "User" (
  "id",
  "email",
  "username",
  "createdAt",
  "updatedAt"
) VALUES
  ('user-a', 'a@fixture.test', 'fixture-a', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('user-b', 'b@fixture.test', 'fixture-b', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO "Recipe" (
  "id",
  "title",
  "chefId",
  "deletedAt",
  "createdAt",
  "updatedAt"
) VALUES
  ('recipe-r1', 'R1 Active', 'user-a', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('recipe-r2', 'R2 Active', 'user-a', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('recipe-r3', 'R3 Deleted', 'user-a', '2026-01-10T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-10T00:00:00.000Z');

INSERT INTO "Cookbook" (
  "id",
  "title",
  "authorId",
  "createdAt",
  "updatedAt"
) VALUES
  ('cookbook-a1', 'A1', 'user-a', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('cookbook-a2', 'A2', 'user-a', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('cookbook-b1', 'B1', 'user-b', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO "RecipeInCookbook" (
  "id",
  "cookbookId",
  "recipeId",
  "addedById",
  "createdAt",
  "updatedAt"
) VALUES
  ('membership-1', 'cookbook-a1', 'recipe-r1', 'user-a', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('membership-2', 'cookbook-a2', 'recipe-r1', 'user-a', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z'),
  ('membership-3', 'cookbook-a1', 'recipe-r2', 'user-a', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
  ('membership-4', 'cookbook-a1', 'recipe-r3', 'user-a', '2026-01-04T00:00:00.000Z', '2026-01-04T00:00:00.000Z'),
  ('membership-5', 'cookbook-b1', 'recipe-r1', 'user-b', '2026-01-05T00:00:00.000Z', '2026-01-05T00:00:00.000Z');

INSERT INTO "ShoppingList" (
  "id",
  "authorId",
  "createdAt",
  "updatedAt"
) VALUES (
  'shopping-a',
  'user-a',
  '2026-01-01T00:00:00.000Z',
  '2026-01-01T00:00:00.000Z'
);

INSERT INTO "IngredientRef" (
  "id",
  "name",
  "updatedAt"
) VALUES (
  'ingredient-flour',
  'fixture-flour',
  '2026-01-01T00:00:00.000Z'
);

INSERT INTO "ShoppingListItem" (
  "id",
  "shoppingListId",
  "quantity",
  "unitId",
  "ingredientRefId",
  "checked",
  "updatedAt",
  "checkedAt",
  "deletedAt",
  "sortIndex",
  "categoryKey",
  "iconKey"
) VALUES
  ('item-b', 'shopping-a', 2, NULL, 'ingredient-flour', 1, '2026-01-01T00:00:00.000Z', NULL, NULL, 1, NULL, NULL),
  ('item-a', 'shopping-a', 1, NULL, 'ingredient-flour', 0, '2026-01-01T00:00:00.000Z', NULL, NULL, 2, NULL, NULL),
  ('item-c', 'shopping-a', NULL, NULL, 'ingredient-flour', 0, '2026-01-01T00:00:00.000Z', NULL, NULL, 3, NULL, NULL);

COMMIT;
