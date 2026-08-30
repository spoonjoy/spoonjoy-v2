ALTER TABLE "OAuthClient" ADD COLUMN "issuer" TEXT;
ALTER TABLE "OAuthAuthCode" ADD COLUMN "issuer" TEXT;
ALTER TABLE "OAuthRefreshToken" ADD COLUMN "issuer" TEXT;
ALTER TABLE "ApiCredential" ADD COLUMN "oauthIssuer" TEXT;
ALTER TABLE "ApiCredential" ADD COLUMN "oauthConnectionKey" TEXT;

CREATE TABLE "OAuthConsentTransaction" (
  "tokenHash" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "issuer" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "codeChallenge" TEXT NOT NULL,
  "resource" TEXT,
  "expiresAt" DATETIME NOT NULL,
  CONSTRAINT "OAuthConsentTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "OAuthConsentTransaction_expiresAt_idx" ON "OAuthConsentTransaction"("expiresAt");
CREATE INDEX "OAuthConsentTransaction_userId_expiresAt_idx" ON "OAuthConsentTransaction"("userId", "expiresAt");
CREATE INDEX "ApiCredential_oauthConnectionKey_idx" ON "ApiCredential"("oauthConnectionKey");
