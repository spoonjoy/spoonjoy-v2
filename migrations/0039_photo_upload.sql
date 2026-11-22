-- Photo upload links (app/lib/photo-upload-link.server.ts): start_photo_upload makes a row, a signed
-- PUT to /api/photo-uploads/<id> stores one photo under R2's pending-uploads/, and an upload action
-- uses it once. Rows are bound to the account that started them (ownerId), last fifteen minutes and
-- are cleared as new ones start.
--
-- Reversible: nothing but the photo upload link code uses this table, so rolling back is
--   DROP TABLE "PhotoUpload";
-- and the previous Worker never names it.
CREATE TABLE "PhotoUpload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "expiresAt" DATETIME NOT NULL,
    "uploadedAt" DATETIME,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "PhotoUpload_ownerId_idx" ON "PhotoUpload"("ownerId");
CREATE INDEX "PhotoUpload_expiresAt_idx" ON "PhotoUpload"("expiresAt");
