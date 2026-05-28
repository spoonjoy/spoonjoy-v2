-- Passkey management metadata for account settings.
-- Nullable columns keep this a trivial, safe ADD COLUMN (no table rebuild,
-- no NOT NULL default); new passkeys set createdAt explicitly on enrollment.
ALTER TABLE "UserCredential" ADD COLUMN "name" TEXT;
ALTER TABLE "UserCredential" ADD COLUMN "createdAt" DATETIME;
