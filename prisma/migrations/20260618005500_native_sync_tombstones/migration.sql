CREATE TABLE "NativeSyncTombstone" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "parentResourceId" TEXT,
  "title" TEXT,
  "deletedAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NativeSyncTombstone_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "NativeSyncTombstone_userId_resourceType_resourceId_key" ON "NativeSyncTombstone"("userId", "resourceType", "resourceId");
CREATE INDEX "NativeSyncTombstone_userId_updatedAt_idx" ON "NativeSyncTombstone"("userId", "updatedAt");
CREATE INDEX "NativeSyncTombstone_resourceType_resourceId_idx" ON "NativeSyncTombstone"("resourceType", "resourceId");
