-- Who may make an account on a self-hosted server (app/lib/server-access.server.ts). ServerSetting holds the
-- server's own settings as keys and values: "admin" is the first account's id and "signups" is "open" or "invite".
-- ServerInvite is an invite link the admin made: one use, until it expires, stored as the SHA-256 of its token.
-- spoonjoy.app never writes either table.
--
-- Additive. Reversible: only server-access.server.ts names these tables, so rolling back is
--   DROP TABLE "ServerInvite"; DROP TABLE "ServerSetting";
-- and the previous Worker never names them.
CREATE TABLE "ServerSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

CREATE TABLE "ServerInvite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "usedById" TEXT,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServerInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ServerInvite_usedById_fkey" FOREIGN KEY ("usedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ServerInvite_tokenHash_key" ON "ServerInvite"("tokenHash");
