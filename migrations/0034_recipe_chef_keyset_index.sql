-- Chef profile recipe pages (users.$identifier.tsx) read
-- `WHERE chefId = ? AND deletedAt IS NULL ORDER BY updatedAt DESC, id DESC`, with a keyset
-- cursor on (updatedAt, id). Recipe_chefId_deletedAt_updatedAt_idx stops at updatedAt, so
-- SQLite sorted the id tiebreak in a temporary B-tree. This index carries id as well, so
-- the page reads in index order and stops at the LIMIT.
CREATE INDEX "Recipe_chefId_deletedAt_updatedAt_id_idx" ON "Recipe"("chefId", "deletedAt", "updatedAt", "id");
