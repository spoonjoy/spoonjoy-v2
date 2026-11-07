-- Moderation: content reports and chef blocks, for App Store guideline 1.2.
--
-- ContentReport: a signed-in chef reports a recipe, chef, cook log (spoon) or cookbook. The target
-- is polymorphic, so it has no foreign key; a report about content that is later deleted stays as
-- the moderation record. A chef has at most one open report per target (the partial unique index),
-- so reporting again returns the open report.
--
-- ChefBlock: a chef hides another chef's recipes, cookbooks, cook logs and profile from themselves.
--
-- Reversible: nothing but the moderation code uses these tables, so rolling back is
--   DROP TABLE "ContentReport"; DROP TABLE "ChefBlock";
-- and the previous Worker never names them.
CREATE TABLE "ContentReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reporterId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetChefId" TEXT,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "ContentReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContentReport_targetType_check" CHECK ("targetType" IN ('recipe', 'chef', 'spoon', 'cookbook')),
    CONSTRAINT "ContentReport_reason_check" CHECK ("reason" IN ('spam', 'offensive', 'harassment', 'copyright', 'other')),
    CONSTRAINT "ContentReport_status_check" CHECK ("status" IN ('open', 'actioned', 'dismissed')),
    CONSTRAINT "ContentReport_details_length_check" CHECK ("details" IS NULL OR length("details") <= 1000)
);

CREATE INDEX "ContentReport_reporterId_idx" ON "ContentReport"("reporterId");
CREATE INDEX "ContentReport_status_createdAt_idx" ON "ContentReport"("status", "createdAt");
CREATE UNIQUE INDEX "ContentReport_open_target_key" ON "ContentReport"("reporterId", "targetType", "targetId") WHERE "status" = 'open';

CREATE TABLE "ChefBlock" (
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("blockerId", "blockedId"),
    CONSTRAINT "ChefBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChefBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChefBlock_not_self_check" CHECK ("blockerId" <> "blockedId")
);

CREATE INDEX "ChefBlock_blockedId_idx" ON "ChefBlock"("blockedId");
