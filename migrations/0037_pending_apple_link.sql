-- Pending Apple links: a verified Apple ID whose sign-in carried no email and matched no linked
-- Spoonjoy account, kept for thirty minutes so the next sign-in by another method on the same device
-- or browser links Apple to that account (app/lib/pending-apple-link.server.ts). The row is keyed by
-- the SHA-256 of a random opaque token the client holds, and is single-use (consumedAt).
--
-- Reversible: nothing but the pending-link code uses this table, so rolling back is
--   DROP TABLE "PendingAppleLink";
-- and the previous Worker never names it.
CREATE TABLE "PendingAppleLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "appleSub" TEXT NOT NULL,
    "providerUsername" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "PendingAppleLink_tokenHash_key" ON "PendingAppleLink"("tokenHash");
CREATE INDEX "PendingAppleLink_expiresAt_idx" ON "PendingAppleLink"("expiresAt");
