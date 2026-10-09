CREATE TABLE IF NOT EXISTS "PhotoCleanup" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "reason" TEXT NOT NULL,
  "firstUnreferencedAt" DATETIME NOT NULL,
  "eligibleAt" DATETIME NOT NULL,
  "sizeBytes" INTEGER,
  "quarantinedAt" DATETIME,
  "purgedAt" DATETIME,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "PhotoCleanup_eligibleAt_idx" ON "PhotoCleanup"("eligibleAt");
CREATE INDEX IF NOT EXISTS "PhotoCleanup_quarantinedAt_idx" ON "PhotoCleanup"("quarantinedAt");

CREATE TABLE IF NOT EXISTS "PhotoSweepRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "mode" TEXT NOT NULL,
  "startedAt" DATETIME NOT NULL,
  "finishedAt" DATETIME NOT NULL,
  "objectsScanned" INTEGER NOT NULL DEFAULT 0,
  "referencedObjects" INTEGER NOT NULL DEFAULT 0,
  "unreferencedObjects" INTEGER NOT NULL DEFAULT 0,
  "unreferencedBytes" INTEGER NOT NULL DEFAULT 0,
  "orphanVariants" INTEGER NOT NULL DEFAULT 0,
  "eligibleObjects" INTEGER NOT NULL DEFAULT 0,
  "quarantined" INTEGER NOT NULL DEFAULT 0,
  "purged" INTEGER NOT NULL DEFAULT 0,
  "failures" INTEGER NOT NULL DEFAULT 0,
  "truncated" BOOLEAN NOT NULL DEFAULT false,
  "note" TEXT
);

CREATE INDEX IF NOT EXISTS "PhotoSweepRun_startedAt_idx" ON "PhotoSweepRun"("startedAt");
