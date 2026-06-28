-- Recipe box / kitchen list performance indexes.
-- recipes._index.tsx runs `WHERE deletedAt IS NULL ORDER BY updatedAt DESC` (no chefId
-- filter), which full-scans + sorts the Recipe table and grows unbounded; chef-scoped
-- kitchen views additionally filter by chefId.
CREATE INDEX "Recipe_deletedAt_updatedAt_idx" ON "Recipe"("deletedAt", "updatedAt");
CREATE INDEX "Recipe_chefId_deletedAt_updatedAt_idx" ON "Recipe"("chefId", "deletedAt", "updatedAt");
