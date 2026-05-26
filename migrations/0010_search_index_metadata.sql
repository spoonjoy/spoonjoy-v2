-- Tracks whether the runtime-built FTS index reflects current source tables.
CREATE TABLE IF NOT EXISTS "SearchIndexMetadata" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sourceFingerprint" TEXT NOT NULL,
  "documentCount" INTEGER NOT NULL DEFAULT 0,
  "rebuiltAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
