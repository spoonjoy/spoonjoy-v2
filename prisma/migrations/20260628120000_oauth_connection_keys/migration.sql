ALTER TABLE "OAuthRefreshToken" ADD COLUMN "connectionKey" TEXT;

CREATE INDEX "OAuthRefreshToken_connectionKey_idx" ON "OAuthRefreshToken"("connectionKey");
