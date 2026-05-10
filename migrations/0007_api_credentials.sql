CREATE TABLE IF NOT EXISTS "ApiCredential" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "tokenPrefix" TEXT NOT NULL,
  "lastUsedAt" DATETIME,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApiCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApiCredential_tokenHash_key" ON "ApiCredential"("tokenHash");
CREATE INDEX IF NOT EXISTS "ApiCredential_userId_idx" ON "ApiCredential"("userId");
CREATE INDEX IF NOT EXISTS "ApiCredential_tokenPrefix_idx" ON "ApiCredential"("tokenPrefix");
