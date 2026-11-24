-- Move-in uploads (app/domains/move-in): a backup sent to storage in parts, so a big one never passes
-- through the Worker's memory and a dropped connection picks up where it stopped. An ImportUpload is
-- one multipart upload: its storage key and upload id, the file it is (name, size and the page's
-- fingerprint of it), its part size, and the job it became once finished. Storage can't list an
-- upload's parts to a Worker, so ImportUploadPart records each part that arrived, with its etag.
-- Deleting an account deletes its uploads; the move-in sweep aborts any left unfinished.
--
-- Additive. Reversible: only move-in's upload code names these tables, so rolling back is
--   DROP TABLE "ImportUploadPart"; DROP TABLE "ImportUpload";
-- and the previous Worker never names them.
CREATE TABLE "ImportUpload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "archiveKey" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "partSize" INTEGER NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT,
    CONSTRAINT "ImportUpload_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ImportUpload_ownerId_fingerprint_idx" ON "ImportUpload"("ownerId", "fingerprint");
CREATE INDEX "ImportUpload_startedAt_idx" ON "ImportUpload"("startedAt");

CREATE TABLE "ImportUploadPart" (
    "uploadId" TEXT NOT NULL,
    "partNumber" INTEGER NOT NULL,
    "etag" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    PRIMARY KEY ("uploadId", "partNumber"),
    CONSTRAINT "ImportUploadPart_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "ImportUpload" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
