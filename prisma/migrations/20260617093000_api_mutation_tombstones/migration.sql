CREATE TABLE "ApiMutationTombstone" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "idempotencyKeyId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "parentResourceId" TEXT,
  "payload" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApiMutationTombstone_idempotencyKeyId_fkey" FOREIGN KEY ("idempotencyKeyId") REFERENCES "ApiIdempotencyKey" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ApiMutationTombstone_idempotencyKeyId_resourceType_resourceId_key" ON "ApiMutationTombstone"("idempotencyKeyId", "resourceType", "resourceId");
CREATE INDEX "ApiMutationTombstone_idempotencyKeyId_idx" ON "ApiMutationTombstone"("idempotencyKeyId");
CREATE INDEX "ApiMutationTombstone_resourceType_resourceId_idx" ON "ApiMutationTombstone"("resourceType", "resourceId");
