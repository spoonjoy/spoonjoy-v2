-- Move-in (app/domains/move-in): a whole kitchen moving in from another recipe app. An ImportJob is
-- one run: it holds the uploaded archive's key, the phase it is in and its resume point. Its
-- ImportSource is the other app's kitchen (one per owner, app and kitchen id), and SourceRecord maps
-- each source row to the Spoonjoy row made from it, so running the same move-in again adds nothing.
-- ImportEntityCount and ImportEvent are the job's counts and its report. Deleting an account deletes
-- all of it.
--
-- Reversible: nothing outside move-in reads these tables, so rolling back is
--   DROP TABLE "SourceRecord"; DROP TABLE "ImportEvent"; DROP TABLE "ImportEntityCount";
--   DROP TABLE "ImportJob"; DROP TABLE "ImportSource";
-- and the previous Worker never names them.
CREATE TABLE "ImportSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "instanceKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "serverUrl" TEXT,
    "sourceVersion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportSource_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ImportSource_ownerId_kind_instanceKey_key" ON "ImportSource"("ownerId", "kind", "instanceKey");

CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "phase" TEXT NOT NULL DEFAULT 'receive',
    "cursor" TEXT,
    "archiveKey" TEXT,
    "archiveName" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "heartbeatAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportJob_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImportJob_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ImportSource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ImportJob_ownerId_createdAt_idx" ON "ImportJob"("ownerId", "createdAt");
CREATE INDEX "ImportJob_sourceId_idx" ON "ImportJob"("sourceId");
CREATE INDEX "ImportJob_status_heartbeatAt_idx" ON "ImportJob"("status", "heartbeatAt");

CREATE TABLE "ImportEntityCount" (
    "jobId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "found" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("jobId", "entity"),
    CONSTRAINT "ImportEntityCount_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ImportJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ImportEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "level" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entity" TEXT,
    "sourceKey" TEXT,
    "targetId" TEXT,
    "message" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ImportJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ImportEvent_jobId_seq_key" ON "ImportEvent"("jobId", "seq");

CREATE TABLE "SourceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "sourceTable" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "sourceUpdatedAt" TEXT,
    "contentHash" TEXT,
    "lastJobId" TEXT NOT NULL,
    CONSTRAINT "SourceRecord_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ImportSource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SourceRecord_sourceId_sourceTable_sourceKey_key" ON "SourceRecord"("sourceId", "sourceTable", "sourceKey");
CREATE INDEX "SourceRecord_targetType_targetId_idx" ON "SourceRecord"("targetType", "targetId");
