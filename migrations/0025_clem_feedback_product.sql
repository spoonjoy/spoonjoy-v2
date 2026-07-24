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

CREATE TABLE "_Migration0025Clock" (
  "singleton" INTEGER PRIMARY KEY CHECK ("singleton" = 1),
  "boundNowMs" INTEGER NOT NULL,
  "boundNowText" TEXT NOT NULL
);

INSERT INTO "_Migration0025Clock" (
  "singleton",
  "boundNowMs",
  "boundNowText"
)
SELECT
  1,
  "captured"."boundNowMs",
  strftime(
    '%Y-%m-%dT%H:%M:%fZ',
    "captured"."boundNowMs" / 1000.0,
    'unixepoch'
  )
FROM (
  SELECT
    CAST(round((julianday('now')-2440587.5)*86400000) AS INTEGER)
      AS "boundNowMs"
) AS "captured";

WITH
"active_items" AS MATERIALIZED (
  SELECT
    "ShoppingListItem".*,
    "ShoppingList"."authorId" AS "ownerId",
    ROW_NUMBER() OVER (
      PARTITION BY
        "ShoppingListItem"."shoppingListId",
        "ShoppingListItem"."ingredientRefId",
        COALESCE('u:' || "ShoppingListItem"."unitId", 'n:')
      ORDER BY
        "ShoppingListItem"."sortIndex" ASC,
        "ShoppingListItem"."id" COLLATE BINARY ASC
    ) AS "survivorRank"
  FROM "ShoppingListItem"
  INNER JOIN "ShoppingList"
    ON "ShoppingList"."id" = "ShoppingListItem"."shoppingListId"
  WHERE "ShoppingListItem"."deletedAt" IS NULL
),
"active_groups" AS MATERIALIZED (
  SELECT
    "shoppingListId",
    "ingredientRefId",
    COALESCE('u:' || "unitId", 'n:') AS "unitIdentity",
    COUNT("quantity") AS "quantityCount",
    SUM("quantity") AS "quantitySum",
    MIN(
      CASE
        WHEN "quantity" IS NULL THEN 1
        WHEN typeof("quantity") IN ('integer', 'real')
          AND "quantity"
            BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308
        THEN 1
        ELSE 0
      END
    ) AS "quantitySourcesValid",
    MIN(
      CASE
        WHEN "checked" = 1 OR "checkedAt" IS NOT NULL THEN 1
        ELSE 0
      END
    ) AS "allLogicallyChecked",
    MIN("checkedAt") AS "minimumCheckedAt"
  FROM "active_items"
  GROUP BY
    "shoppingListId",
    "ingredientRefId",
    COALESCE('u:' || "unitId", 'n:')
),
"user_timestamps" AS MATERIALIZED (
  SELECT
    "id" AS "ownerId",
    CASE
      WHEN typeof("updatedAt") IN ('integer', 'real')
      THEN CAST("updatedAt" AS INTEGER)
      ELSE CAST(
        round((julianday("updatedAt") - 2440587.5) * 86400000)
        AS INTEGER
      )
    END AS "valueMs",
    CASE
      WHEN typeof("updatedAt") IN ('integer', 'real')
        AND CAST("updatedAt" AS INTEGER)
          BETWEEN -62167219200000 AND 253402300799999
      THEN 1
      WHEN typeof("updatedAt") = 'text'
        AND julianday("updatedAt") IS NOT NULL
        AND round((julianday("updatedAt") - 2440587.5) * 86400000)
          BETWEEN -62167219200000 AND 253402300799999
      THEN 1
      ELSE 0
    END AS "valid"
  FROM "User"
),
"recipe_timestamps" AS MATERIALIZED (
  SELECT
    "chefId" AS "ownerId",
    CASE
      WHEN typeof("updatedAt") IN ('integer', 'real')
      THEN CAST("updatedAt" AS INTEGER)
      ELSE CAST(
        round((julianday("updatedAt") - 2440587.5) * 86400000)
        AS INTEGER
      )
    END AS "valueMs",
    CASE
      WHEN typeof("updatedAt") IN ('integer', 'real')
        AND CAST("updatedAt" AS INTEGER)
          BETWEEN -62167219200000 AND 253402300799999
      THEN 1
      WHEN typeof("updatedAt") = 'text'
        AND julianday("updatedAt") IS NOT NULL
        AND round((julianday("updatedAt") - 2440587.5) * 86400000)
          BETWEEN -62167219200000 AND 253402300799999
      THEN 1
      ELSE 0
    END AS "valid"
  FROM "Recipe"
  WHERE "deletedAt" IS NULL
),
"cookbook_timestamps" AS MATERIALIZED (
  SELECT
    "authorId" AS "ownerId",
    CASE
      WHEN typeof("updatedAt") IN ('integer', 'real')
      THEN CAST("updatedAt" AS INTEGER)
      ELSE CAST(
        round((julianday("updatedAt") - 2440587.5) * 86400000)
        AS INTEGER
      )
    END AS "valueMs",
    CASE
      WHEN typeof("updatedAt") IN ('integer', 'real')
        AND CAST("updatedAt" AS INTEGER)
          BETWEEN -62167219200000 AND 253402300799999
      THEN 1
      WHEN typeof("updatedAt") = 'text'
        AND julianday("updatedAt") IS NOT NULL
        AND round((julianday("updatedAt") - 2440587.5) * 86400000)
          BETWEEN -62167219200000 AND 253402300799999
      THEN 1
      ELSE 0
    END AS "valid"
  FROM "Cookbook"
),
"tombstone_timestamps" AS MATERIALIZED (
  SELECT
    "accountId" AS "ownerId",
    CASE
      WHEN typeof("updatedAt") IN ('integer', 'real')
      THEN CAST("updatedAt" AS INTEGER)
      ELSE CAST(
        round((julianday("updatedAt") - 2440587.5) * 86400000)
        AS INTEGER
      )
    END AS "valueMs",
    CASE
      WHEN typeof("updatedAt") IN ('integer', 'real')
        AND CAST("updatedAt" AS INTEGER)
          BETWEEN -62167219200000 AND 253402300799999
      THEN 1
      WHEN typeof("updatedAt") = 'text'
        AND julianday("updatedAt") IS NOT NULL
        AND round((julianday("updatedAt") - 2440587.5) * 86400000)
          BETWEEN -62167219200000 AND 253402300799999
      THEN 1
      ELSE 0
    END AS "valid"
  FROM "NativeSyncTombstone"
),
"shopping_list_timestamps" AS MATERIALIZED (
  SELECT
    "authorId" AS "ownerId",
    CASE
      WHEN typeof("updatedAt") IN ('integer', 'real')
      THEN CAST("updatedAt" AS INTEGER)
      ELSE CAST(
        round((julianday("updatedAt") - 2440587.5) * 86400000)
        AS INTEGER
      )
    END AS "valueMs",
    CASE
      WHEN typeof("updatedAt") IN ('integer', 'real')
        AND CAST("updatedAt" AS INTEGER)
          BETWEEN -62167219200000 AND 253402300799999
      THEN 1
      WHEN typeof("updatedAt") = 'text'
        AND julianday("updatedAt") IS NOT NULL
        AND round((julianday("updatedAt") - 2440587.5) * 86400000)
          BETWEEN -62167219200000 AND 253402300799999
      THEN 1
      ELSE 0
    END AS "valid"
  FROM "ShoppingList"
),
"shopping_item_timestamps" AS MATERIALIZED (
  SELECT
    "ShoppingList"."authorId" AS "ownerId",
    CASE
      WHEN typeof("ShoppingListItem"."updatedAt") IN ('integer', 'real')
      THEN CAST("ShoppingListItem"."updatedAt" AS INTEGER)
      ELSE CAST(
        round(
          (julianday("ShoppingListItem"."updatedAt") - 2440587.5) * 86400000
        ) AS INTEGER
      )
    END AS "valueMs",
    CASE
      WHEN typeof("ShoppingListItem"."updatedAt") IN ('integer', 'real')
        AND CAST("ShoppingListItem"."updatedAt" AS INTEGER)
          BETWEEN -62167219200000 AND 253402300799999
      THEN 1
      WHEN typeof("ShoppingListItem"."updatedAt") = 'text'
        AND julianday("ShoppingListItem"."updatedAt") IS NOT NULL
        AND round(
          (julianday("ShoppingListItem"."updatedAt") - 2440587.5) * 86400000
        ) BETWEEN -62167219200000 AND 253402300799999
      THEN 1
      ELSE 0
    END AS "valid"
  FROM "ShoppingListItem"
  INNER JOIN "ShoppingList"
    ON "ShoppingList"."id" = "ShoppingListItem"."shoppingListId"
),
"owner_high_water" AS MATERIALIZED (
  SELECT
    "user_timestamps"."ownerId",
    CASE
      WHEN "user_timestamps"."valid" <> 1 THEN NULL
      WHEN COALESCE((
        SELECT MIN("valid") FROM "recipe_timestamps"
        WHERE "ownerId" = "user_timestamps"."ownerId"
      ), 1) <> 1 THEN NULL
      WHEN COALESCE((
        SELECT MIN("valid") FROM "cookbook_timestamps"
        WHERE "ownerId" = "user_timestamps"."ownerId"
      ), 1) <> 1 THEN NULL
      WHEN COALESCE((
        SELECT MIN("valid") FROM "tombstone_timestamps"
        WHERE "ownerId" = "user_timestamps"."ownerId"
      ), 1) <> 1 THEN NULL
      WHEN COALESCE((
        SELECT MIN("valid") FROM "shopping_list_timestamps"
        WHERE "ownerId" = "user_timestamps"."ownerId"
      ), 1) <> 1 THEN NULL
      WHEN COALESCE((
        SELECT MIN("valid") FROM "shopping_item_timestamps"
        WHERE "ownerId" = "user_timestamps"."ownerId"
      ), 1) <> 1 THEN NULL
      ELSE max(
        "user_timestamps"."valueMs",
        COALESCE((
          SELECT MAX("valueMs") FROM "recipe_timestamps"
          WHERE "ownerId" = "user_timestamps"."ownerId"
        ), -62167219200000),
        COALESCE((
          SELECT MAX("valueMs") FROM "cookbook_timestamps"
          WHERE "ownerId" = "user_timestamps"."ownerId"
        ), -62167219200000),
        COALESCE((
          SELECT MAX("valueMs") FROM "tombstone_timestamps"
          WHERE "ownerId" = "user_timestamps"."ownerId"
        ), -62167219200000),
        COALESCE((
          SELECT MAX("valueMs") FROM "shopping_list_timestamps"
          WHERE "ownerId" = "user_timestamps"."ownerId"
        ), -62167219200000),
        COALESCE((
          SELECT MAX("valueMs") FROM "shopping_item_timestamps"
          WHERE "ownerId" = "user_timestamps"."ownerId"
        ), -62167219200000)
      )
    END AS "highWaterMs"
  FROM "user_timestamps"
),
"repair_values" AS MATERIALIZED (
  SELECT
    "active_items"."id",
    "active_items"."shoppingListId",
    "active_items"."ingredientRefId",
    "active_items"."unitId",
    "active_items"."survivorRank",
    "active_groups"."quantityCount",
    "active_groups"."quantitySum",
    "active_groups"."allLogicallyChecked",
    "active_groups"."minimumCheckedAt",
    "migration_clock"."boundNowText",
    CASE
      WHEN "active_groups"."quantitySourcesValid" <> 1 THEN NULL
      WHEN "active_groups"."quantityCount" > 0
        AND (
          typeof("active_groups"."quantitySum") NOT IN ('integer', 'real')
          OR "active_groups"."quantitySum" NOT BETWEEN
            -1.7976931348623157e308 AND 1.7976931348623157e308
        )
      THEN NULL
      WHEN "owner_high_water"."highWaterMs" IS NULL THEN NULL
      WHEN "owner_high_water"."highWaterMs" >= 253402300799999 THEN NULL
      ELSE max(
        "migration_clock"."boundNowMs",
        "owner_high_water"."highWaterMs" + 1
      )
    END AS "newMs"
  FROM "active_items"
  INNER JOIN "active_groups"
    ON "active_groups"."shoppingListId" = "active_items"."shoppingListId"
    AND "active_groups"."ingredientRefId" = "active_items"."ingredientRefId"
    AND "active_groups"."unitIdentity"
      = COALESCE('u:' || "active_items"."unitId", 'n:')
  INNER JOIN "owner_high_water"
    ON "owner_high_water"."ownerId" = "active_items"."ownerId"
  CROSS JOIN "_Migration0025Clock" AS "migration_clock"
),
"repairs" AS MATERIALIZED (
  SELECT
    "repair_values".*,
    CASE
      WHEN "repair_values"."newMs" IS NOT NULL
        AND length(
          strftime(
            '%Y-%m-%dT%H:%M:%fZ',
            "repair_values"."newMs" / 1000.0,
            'unixepoch'
          )
        ) = 24
      THEN strftime(
        '%Y-%m-%dT%H:%M:%fZ',
        "repair_values"."newMs" / 1000.0,
        'unixepoch'
      )
      ELSE NULL
    END AS "newText"
  FROM "repair_values"
)
UPDATE "ShoppingListItem" AS "target"
SET
  "quantity" = CASE
    WHEN "repairs"."survivorRank" = 1
      AND "repairs"."quantityCount" = 0
    THEN NULL
    WHEN "repairs"."survivorRank" = 1
    THEN "repairs"."quantitySum"
    ELSE "target"."quantity"
  END,
  "checked" = CASE
    WHEN "repairs"."survivorRank" = 1
      AND "repairs"."allLogicallyChecked" = 1
    THEN 1
    WHEN "repairs"."survivorRank" = 1 THEN 0
    ELSE "target"."checked"
  END,
  "checkedAt" = CASE
    WHEN "repairs"."survivorRank" = 1
      AND "repairs"."allLogicallyChecked" = 1
    THEN "repairs"."minimumCheckedAt"
    WHEN "repairs"."survivorRank" = 1 THEN NULL
    ELSE "target"."checkedAt"
  END,
  "deletedAt" = CASE
    WHEN "repairs"."survivorRank" = 1 THEN NULL
    ELSE "repairs"."boundNowText"
  END,
  "categoryKey" = CASE
    WHEN "repairs"."survivorRank" = 1
    THEN COALESCE(
      "target"."categoryKey",
      (
        SELECT "candidate"."categoryKey"
        FROM "active_items" AS "candidate"
        WHERE "candidate"."shoppingListId" = "repairs"."shoppingListId"
          AND "candidate"."ingredientRefId" = "repairs"."ingredientRefId"
          AND COALESCE('u:' || "candidate"."unitId", 'n:')
            = COALESCE('u:' || "repairs"."unitId", 'n:')
          AND "candidate"."categoryKey" IS NOT NULL
        ORDER BY "candidate"."sortIndex", "candidate"."id" COLLATE BINARY
        LIMIT 1
      )
    )
    ELSE "target"."categoryKey"
  END,
  "iconKey" = CASE
    WHEN "repairs"."survivorRank" = 1
    THEN COALESCE(
      "target"."iconKey",
      (
        SELECT "candidate"."iconKey"
        FROM "active_items" AS "candidate"
        WHERE "candidate"."shoppingListId" = "repairs"."shoppingListId"
          AND "candidate"."ingredientRefId" = "repairs"."ingredientRefId"
          AND COALESCE('u:' || "candidate"."unitId", 'n:')
            = COALESCE('u:' || "repairs"."unitId", 'n:')
          AND "candidate"."iconKey" IS NOT NULL
        ORDER BY "candidate"."sortIndex", "candidate"."id" COLLATE BINARY
        LIMIT 1
      )
    )
    ELSE "target"."iconKey"
  END,
  "updatedAt" = "repairs"."newText"
FROM "repairs"
WHERE "target"."id" = "repairs"."id";

DROP INDEX "ShoppingListItem_shoppingListId_unitId_ingredientRefId_key";

CREATE UNIQUE INDEX "ShoppingListItem_active_identity_key"
ON "ShoppingListItem" (
  "shoppingListId",
  "ingredientRefId",
  COALESCE('u:' || "unitId", 'n:')
)
WHERE "deletedAt" IS NULL;

DROP TABLE "_Migration0025Clock";
