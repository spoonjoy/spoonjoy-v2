-- Add explicit active-cover state to recipes.
ALTER TABLE "Recipe" ADD COLUMN "activeCoverId" TEXT;
ALTER TABLE "Recipe" ADD COLUMN "activeCoverVariant" TEXT;
ALTER TABLE "Recipe" ADD COLUMN "coverMode" TEXT NOT NULL DEFAULT 'auto';

-- Add cover lifecycle and provenance metadata.
ALTER TABLE "RecipeCover" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE "RecipeCover" ADD COLUMN "createdById" TEXT;
ALTER TABLE "RecipeCover" ADD COLUMN "sourceImageUrl" TEXT;
ALTER TABLE "RecipeCover" ADD COLUMN "generationStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "RecipeCover" ADD COLUMN "failureReason" TEXT;
ALTER TABLE "RecipeCover" ADD COLUMN "promptVersion" TEXT;
ALTER TABLE "RecipeCover" ADD COLUMN "styleVersion" TEXT;
ALTER TABLE "RecipeCover" ADD COLUMN "archivedAt" DATETIME;

CREATE INDEX "Recipe_activeCoverId_idx" ON "Recipe"("activeCoverId");
CREATE INDEX "Recipe_coverMode_idx" ON "Recipe"("coverMode");
CREATE INDEX "RecipeCover_recipeId_status_createdAt_idx" ON "RecipeCover"("recipeId", "status", "createdAt");
CREATE INDEX "RecipeCover_status_idx" ON "RecipeCover"("status");

-- Preserve the delete behavior of an optional active-cover relation without
-- rebuilding the Recipe table in existing SQLite/D1 databases.
CREATE TRIGGER IF NOT EXISTS "Recipe_activeCover_delete_set_null"
AFTER DELETE ON "RecipeCover"
BEGIN
  UPDATE "Recipe"
  SET "activeCoverId" = NULL
  WHERE "activeCoverId" = OLD."id";
END;

UPDATE "Recipe"
SET
  "activeCoverId" = (
    SELECT "id"
    FROM "RecipeCover"
    WHERE "RecipeCover"."recipeId" = "Recipe"."id"
      AND "RecipeCover"."status" = 'ready'
      AND "RecipeCover"."archivedAt" IS NULL
      AND (
        ("RecipeCover"."stylizedImageUrl" IS NOT NULL AND "RecipeCover"."stylizedImageUrl" != '')
        OR "RecipeCover"."imageUrl" != ''
      )
    ORDER BY COALESCE(datetime("RecipeCover"."createdAt"), "RecipeCover"."createdAt") DESC, "RecipeCover"."id" DESC
    LIMIT 1
  ),
  "activeCoverVariant" = CASE
    WHEN (
      SELECT "stylizedImageUrl"
      FROM "RecipeCover"
      WHERE "RecipeCover"."recipeId" = "Recipe"."id"
        AND "RecipeCover"."status" = 'ready'
        AND "RecipeCover"."archivedAt" IS NULL
        AND (
          ("RecipeCover"."stylizedImageUrl" IS NOT NULL AND "RecipeCover"."stylizedImageUrl" != '')
          OR "RecipeCover"."imageUrl" != ''
        )
      ORDER BY COALESCE(datetime("RecipeCover"."createdAt"), "RecipeCover"."createdAt") DESC, "RecipeCover"."id" DESC
      LIMIT 1
    ) IS NOT NULL
    AND (
      SELECT "stylizedImageUrl"
      FROM "RecipeCover"
      WHERE "RecipeCover"."recipeId" = "Recipe"."id"
        AND "RecipeCover"."status" = 'ready'
        AND "RecipeCover"."archivedAt" IS NULL
        AND (
          ("RecipeCover"."stylizedImageUrl" IS NOT NULL AND "RecipeCover"."stylizedImageUrl" != '')
          OR "RecipeCover"."imageUrl" != ''
        )
      ORDER BY COALESCE(datetime("RecipeCover"."createdAt"), "RecipeCover"."createdAt") DESC, "RecipeCover"."id" DESC
      LIMIT 1
    ) != '' THEN 'stylized'
    WHEN (
      SELECT "id"
      FROM "RecipeCover"
      WHERE "RecipeCover"."recipeId" = "Recipe"."id"
        AND "RecipeCover"."status" = 'ready'
        AND "RecipeCover"."archivedAt" IS NULL
        AND (
          ("RecipeCover"."stylizedImageUrl" IS NOT NULL AND "RecipeCover"."stylizedImageUrl" != '')
          OR "RecipeCover"."imageUrl" != ''
        )
      ORDER BY COALESCE(datetime("RecipeCover"."createdAt"), "RecipeCover"."createdAt") DESC, "RecipeCover"."id" DESC
      LIMIT 1
    ) IS NOT NULL THEN 'image'
    ELSE NULL
  END,
  "coverMode" = 'auto';
