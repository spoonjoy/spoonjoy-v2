ALTER TABLE "ApiCredential" ADD COLUMN "oauthClientId" TEXT;
ALTER TABLE "ApiCredential" ADD COLUMN "oauthResource" TEXT;
ALTER TABLE "OAuthRefreshToken" ADD COLUMN "resource" TEXT;

CREATE INDEX "ApiCredential_oauthClientId_idx" ON "ApiCredential"("oauthClientId");
CREATE INDEX "ApiCredential_oauthResource_idx" ON "ApiCredential"("oauthResource");
CREATE INDEX "OAuthRefreshToken_clientId_idx" ON "OAuthRefreshToken"("clientId");
