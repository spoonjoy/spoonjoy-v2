-- Canonical complete reviewed template for migrations/0028_recipe_tags.sql.
-- Unit 24 must copy these bytes exactly to both migration copies.

CREATE TABLE IF NOT EXISTS "RecipeTag" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "recipeId" TEXT NOT NULL,
  "label" TEXT NOT NULL CHECK (length("label") > 0),
  "normalizedLabel" TEXT NOT NULL CHECK (length("normalizedLabel") > 0),
  "kind" TEXT NOT NULL CHECK ("kind" IN ('COURSE','CUSTOM')),
  "source" TEXT NOT NULL CHECK ("source" = 'MANUAL'),
  "createdById" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE,
  UNIQUE ("recipeId", "normalizedLabel"),
  CHECK ("kind" <> 'COURSE' OR "normalizedLabel" IN ('main','side','appetizer','dessert')),
  CHECK ("kind" <> 'CUSTOM' OR "normalizedLabel" NOT IN ('main','side','appetizer','dessert'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "RecipeTag_recipeId_course_key" ON "RecipeTag" ("recipeId") WHERE "kind" = 'COURSE';
CREATE INDEX IF NOT EXISTS "RecipeTag_recipeId_kind_normalizedLabel_id_idx" ON "RecipeTag" ("recipeId", "kind" COLLATE BINARY, "normalizedLabel" COLLATE BINARY, "id" COLLATE BINARY);
CREATE INDEX IF NOT EXISTS "RecipeTag_kind_normalizedLabel_recipeId_idx" ON "RecipeTag" ("kind" COLLATE BINARY, "normalizedLabel" COLLATE BINARY, "recipeId" COLLATE BINARY);
CREATE INDEX IF NOT EXISTS "RecipeTag_createdById_idx" ON "RecipeTag" ("createdById");

CREATE TRIGGER IF NOT EXISTS "RecipeTag_custom_limit_bi" BEFORE INSERT ON "RecipeTag"
WHEN NEW."kind" = 'CUSTOM'
 AND NOT EXISTS (SELECT 1 FROM "RecipeTag" WHERE "recipeId" = NEW."recipeId" AND "normalizedLabel" = NEW."normalizedLabel")
 AND (SELECT COUNT(*) FROM "RecipeTag" WHERE "recipeId" = NEW."recipeId" AND "kind" = 'CUSTOM') >= 10
BEGIN
  SELECT RAISE(ABORT, 'recipe_tag_custom_limit');
END;
CREATE TRIGGER IF NOT EXISTS "RecipeTag_custom_limit_bu" BEFORE UPDATE OF "kind", "normalizedLabel", "recipeId" ON "RecipeTag"
WHEN NEW."kind" = 'CUSTOM'
 AND NOT EXISTS (SELECT 1 FROM "RecipeTag" WHERE "recipeId" = NEW."recipeId" AND "normalizedLabel" = NEW."normalizedLabel" AND "id" <> OLD."id")
 AND (SELECT COUNT(*) FROM "RecipeTag" WHERE "recipeId" = NEW."recipeId" AND "kind" = 'CUSTOM' AND "id" <> OLD."id") >= 10
BEGIN
  SELECT RAISE(ABORT, 'recipe_tag_custom_limit');
END;
CREATE TRIGGER IF NOT EXISTS "RecipeTag_parent_ai" AFTER INSERT ON "RecipeTag"
BEGIN
  UPDATE "Recipe" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = NEW."recipeId";
END;
CREATE TRIGGER IF NOT EXISTS "RecipeTag_parent_au" AFTER UPDATE ON "RecipeTag"
WHEN OLD."recipeId" IS NOT NEW."recipeId" OR OLD."label" IS NOT NEW."label" OR OLD."normalizedLabel" IS NOT NEW."normalizedLabel" OR OLD."kind" IS NOT NEW."kind" OR OLD."source" IS NOT NEW."source"
BEGIN
  UPDATE "Recipe" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = NEW."recipeId";
  UPDATE "Recipe" SET "updatedAt" = CURRENT_TIMESTAMP WHERE OLD."recipeId" IS NOT NEW."recipeId" AND "id" = OLD."recipeId";
END;
CREATE TRIGGER IF NOT EXISTS "RecipeTag_parent_ad" AFTER DELETE ON "RecipeTag"
BEGIN
  UPDATE "Recipe" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = OLD."recipeId";
END;

CREATE TABLE IF NOT EXISTS "SearchRebuildLease" (
  "id" TEXT NOT NULL PRIMARY KEY CHECK ("id" = 'current'),
  "lease" TEXT NULL,
  "expiresAtMs" INTEGER NULL CHECK ("expiresAtMs" IS NULL OR "expiresAtMs" BETWEEN 0 AND 9007199254740991),
  CHECK (("lease" IS NULL) = ("expiresAtMs" IS NULL))
);
INSERT INTO "SearchRebuildLease" ("id", "lease", "expiresAtMs") VALUES ('current', NULL, NULL) ON CONFLICT("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "SearchSourceClock" (
  "id" INTEGER NOT NULL PRIMARY KEY CHECK ("id" = 1),
  "currentRevision" INTEGER NOT NULL CHECK ("currentRevision" BETWEEN 0 AND 9007199254740991)
);
INSERT INTO "SearchSourceClock" ("id", "currentRevision") VALUES (1, 0) ON CONFLICT("id") DO NOTHING;
CREATE TABLE IF NOT EXISTS "SearchSourceChange" (
  "revision" INTEGER NOT NULL PRIMARY KEY CHECK ("revision" BETWEEN 1 AND 9007199254740991),
  "sourceKind" TEXT NOT NULL CHECK ("sourceKind" IN ('User','Recipe','RecipeCover','RecipeStep','Ingredient','IngredientRef','Unit','Cookbook','RecipeInCookbook','ShoppingList','ShoppingListItem','RecipeTag')),
  "sourceId" TEXT NOT NULL CHECK (length("sourceId") > 0),
  "operation" TEXT NOT NULL CHECK ("operation" IN ('UPSERT','DELETE')),
  "createdAtMs" INTEGER NOT NULL CHECK ("createdAtMs" BETWEEN 0 AND 9007199254740991)
);
CREATE INDEX IF NOT EXISTS "SearchSourceChange_source_target_idx" ON "SearchSourceChange" ("sourceKind" COLLATE BINARY, "sourceId" COLLATE BINARY, "revision");
CREATE TABLE IF NOT EXISTS "SearchChangeTarget" (
  "revision" INTEGER NOT NULL CHECK ("revision" BETWEEN 1 AND 9007199254740991),
  "entityType" TEXT NOT NULL CHECK ("entityType" IN ('recipe','cookbook','chef','shopping-list-item')),
  "entityId" TEXT NOT NULL CHECK (length("entityId") > 0),
  PRIMARY KEY ("revision", "entityType", "entityId"),
  FOREIGN KEY ("revision") REFERENCES "SearchSourceChange" ("revision") ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS "SearchChangeTarget_target_revision_idx" ON "SearchChangeTarget" ("entityType" COLLATE BINARY, "entityId" COLLATE BINARY, "revision");
CREATE TABLE IF NOT EXISTS "SearchDocumentKey" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "slot" TEXT NOT NULL CHECK ("slot" IN ('blue','green')),
  "entityType" TEXT NOT NULL CHECK ("entityType" IN ('recipe','cookbook','chef','shopping-list-item')),
  "entityId" TEXT NOT NULL CHECK (length("entityId") > 0),
  "ownerId" TEXT NOT NULL CHECK (length("ownerId") > 0),
  UNIQUE ("slot", "entityType", "entityId")
);
CREATE INDEX IF NOT EXISTS "SearchDocumentKey_slot_entity_idx" ON "SearchDocumentKey" ("slot", "entityType" COLLATE BINARY, "entityId" COLLATE BINARY);
CREATE INDEX IF NOT EXISTS "SearchDocumentKey_slot_owner_idx" ON "SearchDocumentKey" ("slot", "ownerId" COLLATE BINARY, "id");
CREATE VIRTUAL TABLE IF NOT EXISTS "SearchDocumentBlue" USING fts5(entityType UNINDEXED,entityId UNINDEXED,ownerId UNINDEXED,ownerUsername UNINDEXED,sortAt UNINDEXED,title,subtitle,body,href UNINDEXED,imageUrl UNINDEXED,metadata UNINDEXED,tokenize='unicode61 remove_diacritics 2',prefix='2 3 4');
CREATE VIRTUAL TABLE IF NOT EXISTS "SearchDocumentGreen" USING fts5(entityType UNINDEXED,entityId UNINDEXED,ownerId UNINDEXED,ownerUsername UNINDEXED,sortAt UNINDEXED,title,subtitle,body,href UNINDEXED,imageUrl UNINDEXED,metadata UNINDEXED,tokenize='unicode61 remove_diacritics 2',prefix='2 3 4');
CREATE TABLE IF NOT EXISTS "SearchIndexAuthority" (
  "id" TEXT NOT NULL PRIMARY KEY CHECK ("id" = 'current'),
  "activeSlot" TEXT NOT NULL CHECK ("activeSlot" IN ('blue','green')),
  "activeRevision" INTEGER NOT NULL CHECK ("activeRevision" BETWEEN 0 AND 9007199254740991),
  "activeDocumentCount" INTEGER NOT NULL CHECK ("activeDocumentCount" BETWEEN 0 AND 9007199254740991),
  "buildSlot" TEXT NULL CHECK ("buildSlot" IS NULL OR "buildSlot" IN ('blue','green')),
  "buildPhase" TEXT NULL CHECK ("buildPhase" IS NULL OR "buildPhase" IN ('clearing','base','delta')),
  "cutoffRevision" INTEGER NULL CHECK ("cutoffRevision" IS NULL OR "cutoffRevision" BETWEEN 0 AND 9007199254740991),
  "appliedRevision" INTEGER NULL CHECK ("appliedRevision" IS NULL OR "appliedRevision" BETWEEN 0 AND 9007199254740991),
  "clearAfterKeyId" INTEGER NULL CHECK ("clearAfterKeyId" IS NULL OR "clearAfterKeyId" BETWEEN 0 AND 9007199254740991),
  "clearRemaining" INTEGER NULL CHECK ("clearRemaining" IS NULL OR "clearRemaining" BETWEEN 0 AND 9007199254740991),
  "baseEntityType" TEXT NULL CHECK ("baseEntityType" IS NULL OR "baseEntityType" IN ('recipe','cookbook','chef','shopping-list-item')),
  "baseEntityId" TEXT NULL,
  "deltaRevision" INTEGER NULL CHECK ("deltaRevision" IS NULL OR "deltaRevision" BETWEEN 0 AND 9007199254740991),
  "deltaTargetEntityType" TEXT NULL CHECK ("deltaTargetEntityType" IS NULL OR "deltaTargetEntityType" IN ('recipe','cookbook','chef','shopping-list-item')),
  "deltaTargetEntityId" TEXT NULL,
  "pendingTargetUpperBound" INTEGER NOT NULL CHECK ("pendingTargetUpperBound" BETWEEN 0 AND 9007199254740991),
  "lease" TEXT NULL,
  "leaseExpiresAtMs" INTEGER NULL CHECK ("leaseExpiresAtMs" IS NULL OR "leaseExpiresAtMs" BETWEEN 0 AND 9007199254740991),
  "updatedAtMs" INTEGER NOT NULL CHECK ("updatedAtMs" BETWEEN 0 AND 9007199254740991),
  CHECK (("buildSlot" IS NULL) = ("buildPhase" IS NULL)),
  CHECK (("lease" IS NULL) = ("leaseExpiresAtMs" IS NULL)),
  CHECK ("buildSlot" IS NULL OR "buildSlot" <> "activeSlot"),
  CHECK ("appliedRevision" IS NULL OR "cutoffRevision" IS NOT NULL AND "appliedRevision" >= "cutoffRevision"),
  CHECK (("buildSlot" IS NULL AND "clearRemaining" IS NULL) OR ("buildSlot" IS NOT NULL AND "clearRemaining" IS NOT NULL))
);

INSERT INTO "SearchDocumentKey" ("slot", "entityType", "entityId", "ownerId")
SELECT 'blue', "entityType", "entityId", "ownerId" FROM "SearchDocument"
WHERE NOT EXISTS (SELECT 1 FROM "SearchIndexAuthority" WHERE "id" = 'current')
ORDER BY "entityType" COLLATE BINARY, "entityId" COLLATE BINARY;
INSERT INTO "SearchDocumentBlue" ("rowid", "entityType", "entityId", "ownerId", "ownerUsername", "sortAt", "title", "subtitle", "body", "href", "imageUrl", "metadata")
SELECT k."id", d."entityType", d."entityId", d."ownerId", d."ownerUsername", d."sortAt", d."title", d."subtitle", d."body", d."href", d."imageUrl", d."metadata"
FROM "SearchDocument" d JOIN "SearchDocumentKey" k ON k."slot" = 'blue' AND k."entityType" = d."entityType" AND k."entityId" = d."entityId"
WHERE NOT EXISTS (SELECT 1 FROM "SearchIndexAuthority" WHERE "id" = 'current')
ORDER BY k."id";
UPDATE "SearchSourceClock" SET "currentRevision" = 1 WHERE "id" = 1 AND "currentRevision" = 0;
INSERT INTO "SearchIndexAuthority" ("id", "activeSlot", "activeRevision", "activeDocumentCount", "buildSlot", "buildPhase", "cutoffRevision", "appliedRevision", "clearAfterKeyId", "clearRemaining", "baseEntityType", "baseEntityId", "deltaRevision", "deltaTargetEntityType", "deltaTargetEntityId", "pendingTargetUpperBound", "lease", "leaseExpiresAtMs", "updatedAtMs")
VALUES ('current', 'blue', 0, (SELECT COUNT(*) FROM "SearchDocumentKey" WHERE "slot" = 'blue'), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, MAX(1, (SELECT COUNT(*) FROM "Recipe" WHERE "deletedAt" IS NULL) + (SELECT COUNT(*) FROM "Cookbook") + (SELECT COUNT(*) FROM "User") + (SELECT COUNT(*) FROM "ShoppingListItem" WHERE "deletedAt" IS NULL)), NULL, NULL, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
ON CONFLICT("id") DO NOTHING;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_User_insert" AFTER INSERT ON "User"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'User', NEW."id", 'UPSERT', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'chef' AS "entityType", NEW."id" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", "id" AS "entityId" FROM "Recipe" WHERE "chefId" = NEW."id") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'cookbook' AS "entityType", "id" AS "entityId" FROM "Cookbook" WHERE "authorId" = NEW."id") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'shopping-list-item' AS "entityType", i."id" AS "entityId" FROM "ShoppingListItem" i JOIN "ShoppingList" l ON l."id" = i."shoppingListId" WHERE l."authorId" = NEW."id") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_User_update" AFTER UPDATE ON "User"
WHEN OLD."id" IS NOT NEW."id" OR OLD."username" IS NOT NEW."username" OR OLD."photoUrl" IS NOT NEW."photoUrl" OR OLD."updatedAt" IS NOT NEW."updatedAt"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'User', NEW."id", 'UPSERT', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'chef' AS "entityType", OLD."id" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", "id" AS "entityId" FROM "Recipe" WHERE "chefId" = OLD."id") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'cookbook' AS "entityType", "id" AS "entityId" FROM "Cookbook" WHERE "authorId" = OLD."id") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'shopping-list-item' AS "entityType", i."id" AS "entityId" FROM "ShoppingListItem" i JOIN "ShoppingList" l ON l."id" = i."shoppingListId" WHERE l."authorId" = OLD."id") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'chef' AS "entityType", NEW."id" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", "id" AS "entityId" FROM "Recipe" WHERE "chefId" = NEW."id") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'cookbook' AS "entityType", "id" AS "entityId" FROM "Cookbook" WHERE "authorId" = NEW."id") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'shopping-list-item' AS "entityType", i."id" AS "entityId" FROM "ShoppingListItem" i JOIN "ShoppingList" l ON l."id" = i."shoppingListId" WHERE l."authorId" = NEW."id") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_User_delete" BEFORE DELETE ON "User"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'User', OLD."id", 'DELETE', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'chef' AS "entityType", OLD."id" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", "id" AS "entityId" FROM "Recipe" WHERE "chefId" = OLD."id") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'cookbook' AS "entityType", "id" AS "entityId" FROM "Cookbook" WHERE "authorId" = OLD."id") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'shopping-list-item' AS "entityType", i."id" AS "entityId" FROM "ShoppingListItem" i JOIN "ShoppingList" l ON l."id" = i."shoppingListId" WHERE l."authorId" = OLD."id") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_Recipe_insert" AFTER INSERT ON "Recipe"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'Recipe', NEW."id", 'UPSERT', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", NEW."id" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'chef' AS "entityType", NEW."chefId" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'cookbook' AS "entityType", "cookbookId" AS "entityId" FROM "RecipeInCookbook" WHERE "recipeId" = NEW."id") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_Recipe_update" AFTER UPDATE ON "Recipe"
WHEN OLD."id" IS NOT NEW."id" OR OLD."chefId" IS NOT NEW."chefId" OR OLD."title" IS NOT NEW."title" OR OLD."description" IS NOT NEW."description" OR OLD."sourceUrl" IS NOT NEW."sourceUrl" OR OLD."servings" IS NOT NEW."servings" OR OLD."deletedAt" IS NOT NEW."deletedAt" OR OLD."updatedAt" IS NOT NEW."updatedAt" OR OLD."activeCoverId" IS NOT NEW."activeCoverId" OR OLD."activeCoverVariant" IS NOT NEW."activeCoverVariant" OR OLD."coverMode" IS NOT NEW."coverMode"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'Recipe', NEW."id", 'UPSERT', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", OLD."id" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'chef' AS "entityType", OLD."chefId" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'cookbook' AS "entityType", "cookbookId" AS "entityId" FROM "RecipeInCookbook" WHERE "recipeId" = OLD."id") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", NEW."id" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'chef' AS "entityType", NEW."chefId" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'cookbook' AS "entityType", "cookbookId" AS "entityId" FROM "RecipeInCookbook" WHERE "recipeId" = NEW."id") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_Recipe_delete" BEFORE DELETE ON "Recipe"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'Recipe', OLD."id", 'DELETE', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", OLD."id" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'chef' AS "entityType", OLD."chefId" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'cookbook' AS "entityType", "cookbookId" AS "entityId" FROM "RecipeInCookbook" WHERE "recipeId" = OLD."id") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_RecipeCover_insert" AFTER INSERT ON "RecipeCover"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'RecipeCover', NEW."id", 'UPSERT', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", NEW."recipeId" AS "entityId") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_RecipeCover_update" AFTER UPDATE ON "RecipeCover"
WHEN OLD."id" IS NOT NEW."id" OR OLD."recipeId" IS NOT NEW."recipeId" OR OLD."imageUrl" IS NOT NEW."imageUrl" OR OLD."stylizedImageUrl" IS NOT NEW."stylizedImageUrl" OR OLD."sourceType" IS NOT NEW."sourceType" OR OLD."status" IS NOT NEW."status" OR OLD."createdAt" IS NOT NEW."createdAt" OR OLD."archivedAt" IS NOT NEW."archivedAt"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'RecipeCover', NEW."id", 'UPSERT', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", OLD."recipeId" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", NEW."recipeId" AS "entityId") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_RecipeCover_delete" BEFORE DELETE ON "RecipeCover"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'RecipeCover', OLD."id", 'DELETE', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", OLD."recipeId" AS "entityId") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_RecipeStep_insert" AFTER INSERT ON "RecipeStep"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'RecipeStep', NEW."id", 'UPSERT', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", NEW."recipeId" AS "entityId") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_RecipeStep_update" AFTER UPDATE ON "RecipeStep"
WHEN OLD."id" IS NOT NEW."id" OR OLD."recipeId" IS NOT NEW."recipeId" OR OLD."stepNum" IS NOT NEW."stepNum" OR OLD."stepTitle" IS NOT NEW."stepTitle" OR OLD."description" IS NOT NEW."description" OR OLD."updatedAt" IS NOT NEW."updatedAt"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'RecipeStep', NEW."id", 'UPSERT', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", OLD."recipeId" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", NEW."recipeId" AS "entityId") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_RecipeStep_delete" BEFORE DELETE ON "RecipeStep"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'RecipeStep', OLD."id", 'DELETE', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", OLD."recipeId" AS "entityId") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_Ingredient_insert" AFTER INSERT ON "Ingredient"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'Ingredient', NEW."id", 'UPSERT', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", NEW."recipeId" AS "entityId") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_Ingredient_update" AFTER UPDATE ON "Ingredient"
WHEN OLD."id" IS NOT NEW."id" OR OLD."recipeId" IS NOT NEW."recipeId" OR OLD."stepNum" IS NOT NEW."stepNum" OR OLD."quantity" IS NOT NEW."quantity" OR OLD."unitId" IS NOT NEW."unitId" OR OLD."ingredientRefId" IS NOT NEW."ingredientRefId" OR OLD."updatedAt" IS NOT NEW."updatedAt"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'Ingredient', NEW."id", 'UPSERT', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", OLD."recipeId" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", NEW."recipeId" AS "entityId") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_Ingredient_delete" BEFORE DELETE ON "Ingredient"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'Ingredient', OLD."id", 'DELETE', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", OLD."recipeId" AS "entityId") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_IngredientRef_insert" AFTER INSERT ON "IngredientRef"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'IngredientRef', NEW."id", 'UPSERT', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", "recipeId" AS "entityId" FROM "Ingredient" WHERE "ingredientRefId" = NEW."id") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'shopping-list-item' AS "entityType", "id" AS "entityId" FROM "ShoppingListItem" WHERE "ingredientRefId" = NEW."id") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_IngredientRef_update" AFTER UPDATE ON "IngredientRef"
WHEN OLD."id" IS NOT NEW."id" OR OLD."name" IS NOT NEW."name" OR OLD."updatedAt" IS NOT NEW."updatedAt"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'IngredientRef', NEW."id", 'UPSERT', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", "recipeId" AS "entityId" FROM "Ingredient" WHERE "ingredientRefId" = OLD."id") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'shopping-list-item' AS "entityType", "id" AS "entityId" FROM "ShoppingListItem" WHERE "ingredientRefId" = OLD."id") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", "recipeId" AS "entityId" FROM "Ingredient" WHERE "ingredientRefId" = NEW."id") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'shopping-list-item' AS "entityType", "id" AS "entityId" FROM "ShoppingListItem" WHERE "ingredientRefId" = NEW."id") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_IngredientRef_delete" BEFORE DELETE ON "IngredientRef"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'IngredientRef', OLD."id", 'DELETE', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", "recipeId" AS "entityId" FROM "Ingredient" WHERE "ingredientRefId" = OLD."id") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'shopping-list-item' AS "entityType", "id" AS "entityId" FROM "ShoppingListItem" WHERE "ingredientRefId" = OLD."id") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_Unit_insert" AFTER INSERT ON "Unit"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'Unit', NEW."id", 'UPSERT', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", "recipeId" AS "entityId" FROM "Ingredient" WHERE "unitId" = NEW."id") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'shopping-list-item' AS "entityType", "id" AS "entityId" FROM "ShoppingListItem" WHERE "unitId" = NEW."id") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_Unit_update" AFTER UPDATE ON "Unit"
WHEN OLD."id" IS NOT NEW."id" OR OLD."name" IS NOT NEW."name" OR OLD."updatedAt" IS NOT NEW."updatedAt"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'Unit', NEW."id", 'UPSERT', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", "recipeId" AS "entityId" FROM "Ingredient" WHERE "unitId" = OLD."id") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'shopping-list-item' AS "entityType", "id" AS "entityId" FROM "ShoppingListItem" WHERE "unitId" = OLD."id") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", "recipeId" AS "entityId" FROM "Ingredient" WHERE "unitId" = NEW."id") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'shopping-list-item' AS "entityType", "id" AS "entityId" FROM "ShoppingListItem" WHERE "unitId" = NEW."id") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_Unit_delete" BEFORE DELETE ON "Unit"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'Unit', OLD."id", 'DELETE', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", "recipeId" AS "entityId" FROM "Ingredient" WHERE "unitId" = OLD."id") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'shopping-list-item' AS "entityType", "id" AS "entityId" FROM "ShoppingListItem" WHERE "unitId" = OLD."id") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_Cookbook_insert" AFTER INSERT ON "Cookbook"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'Cookbook', NEW."id", 'UPSERT', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'cookbook' AS "entityType", NEW."id" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'chef' AS "entityType", NEW."authorId" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", "recipeId" AS "entityId" FROM "RecipeInCookbook" WHERE "cookbookId" = NEW."id") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_Cookbook_update" AFTER UPDATE ON "Cookbook"
WHEN OLD."id" IS NOT NEW."id" OR OLD."authorId" IS NOT NEW."authorId" OR OLD."title" IS NOT NEW."title" OR OLD."updatedAt" IS NOT NEW."updatedAt"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'Cookbook', NEW."id", 'UPSERT', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'cookbook' AS "entityType", OLD."id" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'chef' AS "entityType", OLD."authorId" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", "recipeId" AS "entityId" FROM "RecipeInCookbook" WHERE "cookbookId" = OLD."id") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'cookbook' AS "entityType", NEW."id" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'chef' AS "entityType", NEW."authorId" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", "recipeId" AS "entityId" FROM "RecipeInCookbook" WHERE "cookbookId" = NEW."id") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_Cookbook_delete" BEFORE DELETE ON "Cookbook"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'Cookbook', OLD."id", 'DELETE', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'cookbook' AS "entityType", OLD."id" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'chef' AS "entityType", OLD."authorId" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", "recipeId" AS "entityId" FROM "RecipeInCookbook" WHERE "cookbookId" = OLD."id") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_RecipeInCookbook_insert" AFTER INSERT ON "RecipeInCookbook"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'RecipeInCookbook', NEW."id", 'UPSERT', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", NEW."recipeId" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'cookbook' AS "entityType", NEW."cookbookId" AS "entityId") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_RecipeInCookbook_update" AFTER UPDATE ON "RecipeInCookbook"
WHEN OLD."id" IS NOT NEW."id" OR OLD."recipeId" IS NOT NEW."recipeId" OR OLD."cookbookId" IS NOT NEW."cookbookId" OR OLD."updatedAt" IS NOT NEW."updatedAt"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'RecipeInCookbook', NEW."id", 'UPSERT', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", OLD."recipeId" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'cookbook' AS "entityType", OLD."cookbookId" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", NEW."recipeId" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'cookbook' AS "entityType", NEW."cookbookId" AS "entityId") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_RecipeInCookbook_delete" BEFORE DELETE ON "RecipeInCookbook"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'RecipeInCookbook', OLD."id", 'DELETE', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", OLD."recipeId" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'cookbook' AS "entityType", OLD."cookbookId" AS "entityId") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_ShoppingList_insert" AFTER INSERT ON "ShoppingList"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'ShoppingList', NEW."id", 'UPSERT', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'shopping-list-item' AS "entityType", "id" AS "entityId" FROM "ShoppingListItem" WHERE "shoppingListId" = NEW."id") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_ShoppingList_update" AFTER UPDATE ON "ShoppingList"
WHEN OLD."id" IS NOT NEW."id" OR OLD."authorId" IS NOT NEW."authorId"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'ShoppingList', NEW."id", 'UPSERT', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'shopping-list-item' AS "entityType", "id" AS "entityId" FROM "ShoppingListItem" WHERE "shoppingListId" = OLD."id") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'shopping-list-item' AS "entityType", "id" AS "entityId" FROM "ShoppingListItem" WHERE "shoppingListId" = NEW."id") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_ShoppingList_delete" BEFORE DELETE ON "ShoppingList"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'ShoppingList', OLD."id", 'DELETE', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'shopping-list-item' AS "entityType", "id" AS "entityId" FROM "ShoppingListItem" WHERE "shoppingListId" = OLD."id") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_ShoppingListItem_insert" AFTER INSERT ON "ShoppingListItem"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'ShoppingListItem', NEW."id", 'UPSERT', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'shopping-list-item' AS "entityType", NEW."id" AS "entityId") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_ShoppingListItem_update" AFTER UPDATE ON "ShoppingListItem"
WHEN OLD."id" IS NOT NEW."id" OR OLD."shoppingListId" IS NOT NEW."shoppingListId" OR OLD."ingredientRefId" IS NOT NEW."ingredientRefId" OR OLD."quantity" IS NOT NEW."quantity" OR OLD."unitId" IS NOT NEW."unitId" OR OLD."checked" IS NOT NEW."checked" OR OLD."categoryKey" IS NOT NEW."categoryKey" OR OLD."iconKey" IS NOT NEW."iconKey" OR OLD."sortIndex" IS NOT NEW."sortIndex" OR OLD."deletedAt" IS NOT NEW."deletedAt" OR OLD."updatedAt" IS NOT NEW."updatedAt"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'ShoppingListItem', NEW."id", 'UPSERT', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'shopping-list-item' AS "entityType", OLD."id" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'shopping-list-item' AS "entityType", NEW."id" AS "entityId") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_ShoppingListItem_delete" BEFORE DELETE ON "ShoppingListItem"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'ShoppingListItem', OLD."id", 'DELETE', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'shopping-list-item' AS "entityType", OLD."id" AS "entityId") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_RecipeTag_insert" AFTER INSERT ON "RecipeTag"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'RecipeTag', NEW."id", 'UPSERT', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", NEW."recipeId" AS "entityId") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_RecipeTag_update" AFTER UPDATE ON "RecipeTag"
WHEN OLD."id" IS NOT NEW."id" OR OLD."recipeId" IS NOT NEW."recipeId" OR OLD."label" IS NOT NEW."label" OR OLD."normalizedLabel" IS NOT NEW."normalizedLabel" OR OLD."kind" IS NOT NEW."kind" OR OLD."source" IS NOT NEW."source"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'RecipeTag', NEW."id", 'UPSERT', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", OLD."recipeId" AS "entityId") t WHERE length(t."entityId") > 0;
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", NEW."recipeId" AS "entityId") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

CREATE TRIGGER IF NOT EXISTS "SearchJournal_RecipeTag_delete" BEFORE DELETE ON "RecipeTag"
BEGIN
  SELECT CASE WHEN (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1) >= 9007199254740991 THEN RAISE(ABORT, 'search_revision_overflow') END;
  UPDATE "SearchSourceClock" SET "currentRevision" = "currentRevision" + 1 WHERE "id" = 1;
  INSERT INTO "SearchSourceChange" ("revision", "sourceKind", "sourceId", "operation", "createdAtMs") VALUES ((SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), 'RecipeTag', OLD."id", 'DELETE', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
  INSERT OR IGNORE INTO "SearchChangeTarget" ("revision", "entityType", "entityId")
  SELECT (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1), t."entityType", t."entityId" FROM (SELECT 'recipe' AS "entityType", OLD."recipeId" AS "entityId") t WHERE length(t."entityId") > 0;
  SELECT CASE WHEN (SELECT "pendingTargetUpperBound" FROM "SearchIndexAuthority" WHERE "id" = 'current') > 9007199254740991 - (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)) THEN RAISE(ABORT, 'search_pending_overflow') END;
  UPDATE "SearchIndexAuthority" SET "pendingTargetUpperBound" = "pendingTargetUpperBound" + (SELECT COUNT(*) FROM "SearchChangeTarget" WHERE "revision" = (SELECT "currentRevision" FROM "SearchSourceClock" WHERE "id" = 1)), "updatedAtMs" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE "id" = 'current';
END;

-- SPOONJOY_MIGRATION_ATTESTATION_SENTINEL
