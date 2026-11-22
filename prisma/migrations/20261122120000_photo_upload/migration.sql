-- Photo upload links (see migrations/0039_photo_upload.sql).
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
