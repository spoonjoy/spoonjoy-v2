CREATE TABLE IF NOT EXISTS "NativeSyncTombstone" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "parentResourceId" TEXT,
  "title" TEXT,
  "deletedAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NativeSyncTombstone_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "NativeSyncTombstone_accountId_resourceType_resourceId_key" ON "NativeSyncTombstone"("accountId", "resourceType", "resourceId");
CREATE INDEX IF NOT EXISTS "NativeSyncTombstone_accountId_updatedAt_resourceId_idx" ON "NativeSyncTombstone"("accountId", "updatedAt", "resourceId");
CREATE INDEX IF NOT EXISTS "NativeSyncTombstone_accountId_resourceType_updatedAt_idx" ON "NativeSyncTombstone"("accountId", "resourceType", "updatedAt");
