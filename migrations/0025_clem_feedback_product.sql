ALTER TABLE "Recipe"
ADD COLUMN "course" TEXT
CHECK ("course" IS NULL OR "course" IN ('main','side','appetizer','dessert'));

CREATE INDEX "Recipe_course_deletedAt_updatedAt_idx"
ON "Recipe"("course", "deletedAt", "updatedAt");

CREATE TABLE "SavedRecipe" (
  "userId" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL,
  "savedAt" TEXT NOT NULL
    CHECK (typeof(savedAt) = 'text' AND length(savedAt) = 24 AND length(CAST(savedAt AS BLOB)) = 24 AND substr(savedAt,5,1) = '-' AND substr(savedAt,8,1) = '-' AND substr(savedAt,11,1) = 'T' AND substr(savedAt,14,1) = ':' AND substr(savedAt,17,1) = ':' AND substr(savedAt,20,1) = '.' AND substr(savedAt,24,1) = 'Z' AND substr(savedAt,1,4) NOT GLOB '*[^0-9]*' AND substr(savedAt,6,2) NOT GLOB '*[^0-9]*' AND substr(savedAt,9,2) NOT GLOB '*[^0-9]*' AND substr(savedAt,12,2) NOT GLOB '*[^0-9]*' AND substr(savedAt,15,2) NOT GLOB '*[^0-9]*' AND substr(savedAt,18,2) NOT GLOB '*[^0-9]*' AND substr(savedAt,21,3) NOT GLOB '*[^0-9]*' AND date(substr(savedAt,1,10)) = substr(savedAt,1,10) AND substr(savedAt,12,2) BETWEEN '00' AND '23' AND substr(savedAt,15,2) BETWEEN '00' AND '59' AND substr(savedAt,18,2) BETWEEN '00' AND '59' AND strftime('%Y-%m-%dT%H:%M:%fZ', savedAt) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', savedAt) = savedAt),
  PRIMARY KEY ("userId", "recipeId"),
  CONSTRAINT "SavedRecipe_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SavedRecipe_recipeId_fkey"
    FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SavedRecipe_userId_savedAt_recipeId_idx"
ON "SavedRecipe"("userId", "savedAt", "recipeId");

CREATE INDEX "SavedRecipe_recipeId_idx"
ON "SavedRecipe"("recipeId");

CREATE TABLE "RecipeTag" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "recipeId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "normalizedLabel" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecipeTag_recipeId_fkey"
    FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RecipeTag_recipeId_normalizedLabel_key"
ON "RecipeTag"("recipeId", "normalizedLabel");

CREATE INDEX "RecipeTag_normalizedLabel_recipeId_idx"
ON "RecipeTag"("normalizedLabel", "recipeId");

WITH "normalized_memberships" AS (
  SELECT
    "Cookbook"."authorId" AS "userId",
    "RecipeInCookbook"."recipeId" AS "recipeId",
    CASE
      WHEN typeof("RecipeInCookbook"."createdAt") = 'integer'
        AND "RecipeInCookbook"."createdAt"
          BETWEEN -62167219200000 AND 253402300799999
      THEN strftime(
        '%Y-%m-%dT%H:%M:%fZ',
        "RecipeInCookbook"."createdAt" / 1000.0,
        'unixepoch'
      )
      WHEN typeof("RecipeInCookbook"."createdAt") = 'real'
        AND round("RecipeInCookbook"."createdAt")
          BETWEEN -62167219200000 AND 253402300799999
      THEN strftime(
        '%Y-%m-%dT%H:%M:%fZ',
        round("RecipeInCookbook"."createdAt") / 1000.0,
        'unixepoch'
      )
      WHEN typeof("RecipeInCookbook"."createdAt") = 'text'
        AND length("RecipeInCookbook"."createdAt")
          IN (19, 20, 24, 25, 29)
        AND length(CAST("RecipeInCookbook"."createdAt" AS BLOB))
          = length("RecipeInCookbook"."createdAt")
        AND substr("RecipeInCookbook"."createdAt", 5, 1) = '-'
        AND substr("RecipeInCookbook"."createdAt", 8, 1) = '-'
        AND substr("RecipeInCookbook"."createdAt", 14, 1) = ':'
        AND substr("RecipeInCookbook"."createdAt", 17, 1) = ':'
        AND substr("RecipeInCookbook"."createdAt", 1, 4)
          NOT GLOB '*[^0-9]*'
        AND substr("RecipeInCookbook"."createdAt", 6, 2)
          NOT GLOB '*[^0-9]*'
        AND substr("RecipeInCookbook"."createdAt", 9, 2)
          NOT GLOB '*[^0-9]*'
        AND substr("RecipeInCookbook"."createdAt", 12, 2)
          NOT GLOB '*[^0-9]*'
        AND substr("RecipeInCookbook"."createdAt", 15, 2)
          NOT GLOB '*[^0-9]*'
        AND substr("RecipeInCookbook"."createdAt", 18, 2)
          NOT GLOB '*[^0-9]*'
        AND date(substr("RecipeInCookbook"."createdAt", 1, 10))
          = substr("RecipeInCookbook"."createdAt", 1, 10)
        AND substr("RecipeInCookbook"."createdAt", 12, 2)
          BETWEEN '00' AND '23'
        AND substr("RecipeInCookbook"."createdAt", 15, 2)
          BETWEEN '00' AND '59'
        AND substr("RecipeInCookbook"."createdAt", 18, 2)
          BETWEEN '00' AND '59'
        AND (
          (
            length("RecipeInCookbook"."createdAt") = 19
            AND substr("RecipeInCookbook"."createdAt", 11, 1) = ' '
          )
          OR (
            length("RecipeInCookbook"."createdAt") = 20
            AND substr("RecipeInCookbook"."createdAt", 11, 1) = 'T'
            AND substr("RecipeInCookbook"."createdAt", 20, 1) = 'Z'
          )
          OR (
            length("RecipeInCookbook"."createdAt") = 24
            AND substr("RecipeInCookbook"."createdAt", 11, 1) = 'T'
            AND substr("RecipeInCookbook"."createdAt", 20, 1) = '.'
            AND substr("RecipeInCookbook"."createdAt", 21, 3)
              NOT GLOB '*[^0-9]*'
            AND substr("RecipeInCookbook"."createdAt", 24, 1) = 'Z'
          )
          OR (
            length("RecipeInCookbook"."createdAt") = 25
            AND substr("RecipeInCookbook"."createdAt", 11, 1) = 'T'
            AND substr("RecipeInCookbook"."createdAt", 20, 1) IN ('+', '-')
            AND substr("RecipeInCookbook"."createdAt", 21, 2)
              NOT GLOB '*[^0-9]*'
            AND substr("RecipeInCookbook"."createdAt", 23, 1) = ':'
            AND substr("RecipeInCookbook"."createdAt", 24, 2)
              NOT GLOB '*[^0-9]*'
            AND substr("RecipeInCookbook"."createdAt", 24, 2)
              BETWEEN '00' AND '59'
            AND (
              substr("RecipeInCookbook"."createdAt", 21, 2)
                BETWEEN '00' AND '13'
              OR (
                substr("RecipeInCookbook"."createdAt", 21, 2) = '14'
                AND substr("RecipeInCookbook"."createdAt", 24, 2) = '00'
              )
            )
          )
          OR (
            length("RecipeInCookbook"."createdAt") = 29
            AND substr("RecipeInCookbook"."createdAt", 11, 1) = 'T'
            AND substr("RecipeInCookbook"."createdAt", 20, 1) = '.'
            AND substr("RecipeInCookbook"."createdAt", 21, 3)
              NOT GLOB '*[^0-9]*'
            AND substr("RecipeInCookbook"."createdAt", 24, 1) IN ('+', '-')
            AND substr("RecipeInCookbook"."createdAt", 25, 2)
              NOT GLOB '*[^0-9]*'
            AND substr("RecipeInCookbook"."createdAt", 27, 1) = ':'
            AND substr("RecipeInCookbook"."createdAt", 28, 2)
              NOT GLOB '*[^0-9]*'
            AND substr("RecipeInCookbook"."createdAt", 28, 2)
              BETWEEN '00' AND '59'
            AND (
              substr("RecipeInCookbook"."createdAt", 25, 2)
                BETWEEN '00' AND '13'
              OR (
                substr("RecipeInCookbook"."createdAt", 25, 2) = '14'
                AND substr("RecipeInCookbook"."createdAt", 28, 2) = '00'
              )
            )
          )
        )
        AND julianday("RecipeInCookbook"."createdAt") IS NOT NULL
      THEN strftime(
        '%Y-%m-%dT%H:%M:%fZ',
        "RecipeInCookbook"."createdAt"
      )
      ELSE NULL
    END AS "savedAt"
  FROM "RecipeInCookbook"
  INNER JOIN "Cookbook"
    ON "Cookbook"."id" = "RecipeInCookbook"."cookbookId"
),
"latest_memberships" AS (
  SELECT
    "userId",
    "recipeId",
    CASE
      WHEN COUNT("savedAt") = COUNT(*)
      THEN MAX("savedAt")
      ELSE NULL
    END AS "savedAt"
  FROM "normalized_memberships"
  GROUP BY "userId", "recipeId"
)
INSERT INTO "SavedRecipe" ("userId", "recipeId", "savedAt")
SELECT "userId", "recipeId", "savedAt"
FROM "latest_memberships";

CREATE TRIGGER "SavedRecipe_cutover_block_membership_insert"
BEFORE INSERT ON "RecipeInCookbook"
BEGIN
  SELECT RAISE(ABORT, 'saved_recipe_cutover_pending');
END;

CREATE TRIGGER "SavedRecipe_cutover_block_membership_delete"
BEFORE DELETE ON "RecipeInCookbook"
BEGIN
  SELECT RAISE(ABORT, 'saved_recipe_cutover_pending');
END;
