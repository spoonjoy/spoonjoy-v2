-- OAuth 2.1 authorization-server tables for remote MCP connectors
-- (e.g. the claude.ai one-click connector). Clients self-register via
-- Dynamic Client Registration; auth codes are short-lived + single-use.

CREATE TABLE "OAuthClient" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "clientName"   TEXT,
  "redirectUris" TEXT NOT NULL,
  "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "OAuthAuthCode" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "codeHash"      TEXT NOT NULL,
  "clientId"      TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "redirectUri"   TEXT NOT NULL,
  "codeChallenge" TEXT NOT NULL,
  "scope"         TEXT NOT NULL,
  "resource"      TEXT,
  "expiresAt"     DATETIME NOT NULL,
  "consumedAt"    DATETIME,
  "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthAuthCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OAuthAuthCode_codeHash_key" ON "OAuthAuthCode"("codeHash");
CREATE INDEX "OAuthAuthCode_userId_idx" ON "OAuthAuthCode"("userId");
