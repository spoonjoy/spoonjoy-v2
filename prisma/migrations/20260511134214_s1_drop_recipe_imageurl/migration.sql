-- Backfill RecipeCover rows for any Recipe whose imageUrl is non-empty and is
-- NOT the legacy v1 Cloudinary stock token. Mirrors the Cloudflare D1 migration
-- in migrations/0008_s1_spoon_foundation.sql.
INSERT INTO "RecipeCover" ("id","recipeId","imageUrl","sourceType","createdAt")
SELECT lower(hex(randomblob(12))), id, imageUrl, 'chef-upload', createdAt
FROM "Recipe"
WHERE imageUrl IS NOT NULL
  AND imageUrl != ''
  AND imageUrl NOT LIKE '%clbe7wr180009tkhggghtl1qd.png%';

-- Drop the column directly (SQLite 3.35+; D1 supports it).
ALTER TABLE "Recipe" DROP COLUMN "imageUrl";
