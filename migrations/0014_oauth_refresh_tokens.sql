-- Refresh-token support for the OAuth connector: an optional access-token
-- expiry (only OAuth-issued tokens set it) and a rotated refresh-token table.

ALTER TABLE "ApiCredential" ADD COLUMN "expiresAt" DATETIME;

CREATE TABLE "OAuthRefreshToken" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "tokenHash" TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "clientId"  TEXT NOT NULL,
  "scope"     TEXT NOT NULL,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthRefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OAuthRefreshToken_tokenHash_key" ON "OAuthRefreshToken"("tokenHash");
CREATE INDEX "OAuthRefreshToken_userId_idx" ON "OAuthRefreshToken"("userId");
