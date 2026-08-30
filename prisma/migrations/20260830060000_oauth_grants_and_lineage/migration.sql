ALTER TABLE "OAuthAuthCode" ADD COLUMN "grantId" TEXT;
ALTER TABLE "OAuthRefreshToken" ADD COLUMN "grantId" TEXT;
ALTER TABLE "ApiCredential" ADD COLUMN "oauthGrantId" TEXT;

CREATE TABLE "OAuthGrant" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "issuer" TEXT NOT NULL,
  "resource" TEXT,
  "scope" TEXT NOT NULL,
  "connectionKey" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "statusReason" TEXT,
  "statusChangedAt" DATETIME NOT NULL,
  "expiresAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OAuthGrant_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OAuthClient" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OAuthGrant_connectionKey_key" UNIQUE ("connectionKey"),
  CONSTRAINT "OAuthGrant_status_reason_check" CHECK (
    ("status" = 'active' AND "statusReason" IS NULL)
    OR ("status" = 'revoked' AND "statusReason" IS NOT NULL AND "statusReason" IN (
      'disconnect', 'client_revoked', 'administrative', 'security_event',
      'inactivity_expiry', 'absolute_expiry'
    ))
    OR ("status" = 'compromised' AND "statusReason" IS NOT NULL AND "statusReason" = 'refresh_reuse')
  )
);

CREATE TABLE "OAuthTokenIssuance" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "grantId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "authorizationCodeId" TEXT,
  "parentRefreshTokenId" TEXT,
  "accessCredentialId" TEXT NOT NULL,
  "refreshTokenId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthTokenIssuance_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "OAuthGrant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OAuthTokenIssuance_authorizationCodeId_fkey" FOREIGN KEY ("authorizationCodeId") REFERENCES "OAuthAuthCode" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "OAuthTokenIssuance_parentRefreshTokenId_fkey" FOREIGN KEY ("parentRefreshTokenId") REFERENCES "OAuthRefreshToken" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "OAuthTokenIssuance_accessCredentialId_fkey" FOREIGN KEY ("accessCredentialId") REFERENCES "ApiCredential" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "OAuthTokenIssuance_refreshTokenId_fkey" FOREIGN KEY ("refreshTokenId") REFERENCES "OAuthRefreshToken" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "OAuthTokenIssuance_authorizationCodeId_key" UNIQUE ("authorizationCodeId"),
  CONSTRAINT "OAuthTokenIssuance_parentRefreshTokenId_key" UNIQUE ("parentRefreshTokenId"),
  CONSTRAINT "OAuthTokenIssuance_accessCredentialId_key" UNIQUE ("accessCredentialId"),
  CONSTRAINT "OAuthTokenIssuance_refreshTokenId_key" UNIQUE ("refreshTokenId"),
  CONSTRAINT "OAuthTokenIssuance_lineage_identity_key" UNIQUE ("id", "grantId", "refreshTokenId", "kind"),
  CONSTRAINT "OAuthTokenIssuance_parent_source_key" UNIQUE ("id", "parentRefreshTokenId"),
  CONSTRAINT "OAuthTokenIssuance_source_check" CHECK (
    ("kind" = 'authorization_code' AND "authorizationCodeId" IS NOT NULL AND "parentRefreshTokenId" IS NULL)
    OR ("kind" = 'refresh_token' AND "authorizationCodeId" IS NULL AND "parentRefreshTokenId" IS NOT NULL)
  )
);

CREATE TABLE "OAuthRefreshLineage" (
  "refreshTokenId" TEXT NOT NULL PRIMARY KEY,
  "grantId" TEXT NOT NULL,
  "issuanceId" TEXT NOT NULL,
  "issuanceKind" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "parentRefreshTokenId" TEXT,
  "parentGeneration" INTEGER,
  "retiredAt" DATETIME,
  "retirementReason" TEXT,
  "expiresAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthRefreshLineage_refreshTokenId_fkey" FOREIGN KEY ("refreshTokenId") REFERENCES "OAuthRefreshToken" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "OAuthRefreshLineage_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "OAuthGrant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OAuthRefreshLineage_issuance_identity_fkey" FOREIGN KEY ("issuanceId", "grantId", "refreshTokenId", "issuanceKind") REFERENCES "OAuthTokenIssuance" ("id", "grantId", "refreshTokenId", "kind") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "OAuthRefreshLineage_issuance_parent_fkey" FOREIGN KEY ("issuanceId", "parentRefreshTokenId") REFERENCES "OAuthTokenIssuance" ("id", "parentRefreshTokenId") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "OAuthRefreshLineage_parent_fkey" FOREIGN KEY ("parentRefreshTokenId", "parentGeneration", "grantId") REFERENCES "OAuthRefreshLineage" ("refreshTokenId", "generation", "grantId") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "OAuthRefreshLineage_issuanceId_key" UNIQUE ("issuanceId"),
  CONSTRAINT "OAuthRefreshLineage_grantId_generation_key" UNIQUE ("grantId", "generation"),
  CONSTRAINT "OAuthRefreshLineage_parentRefreshTokenId_key" UNIQUE ("parentRefreshTokenId"),
  CONSTRAINT "OAuthRefreshLineage_identity_key" UNIQUE ("refreshTokenId", "generation", "grantId"),
  CONSTRAINT "OAuthRefreshLineage_generation_check" CHECK (
    ("generation" = 0 AND "issuanceKind" = 'authorization_code' AND "parentRefreshTokenId" IS NULL AND "parentGeneration" IS NULL)
    OR (
      "generation" > 0
      AND "issuanceKind" = 'refresh_token'
      AND "parentRefreshTokenId" IS NOT NULL
      AND "parentGeneration" IS NOT NULL
      AND "generation" = "parentGeneration" + 1
    )
  ),
  CONSTRAINT "OAuthRefreshLineage_retirement_check" CHECK (
    ("retiredAt" IS NULL AND "retirementReason" IS NULL)
    OR (
      "retiredAt" IS NOT NULL
      AND "retirementReason" IS NOT NULL
      AND "retirementReason" IN (
        'rotated', 'disconnect', 'client_revoked', 'refresh_reuse',
        'administrative', 'security_event', 'inactivity_expiry', 'absolute_expiry'
      )
    )
  )
);

CREATE INDEX "OAuthAuthCode_grantId_idx" ON "OAuthAuthCode"("grantId");
CREATE INDEX "OAuthRefreshToken_grantId_idx" ON "OAuthRefreshToken"("grantId");
CREATE INDEX "ApiCredential_oauthGrantId_idx" ON "ApiCredential"("oauthGrantId");
CREATE INDEX "OAuthGrant_user_client_issuer_status_idx" ON "OAuthGrant"("userId", "clientId", "issuer", "status");
CREATE INDEX "OAuthGrant_clientId_idx" ON "OAuthGrant"("clientId");
CREATE INDEX "OAuthGrant_status_changed_idx" ON "OAuthGrant"("status", "statusChangedAt");
CREATE INDEX "OAuthGrant_status_expires_idx" ON "OAuthGrant"("status", "expiresAt");
CREATE INDEX "OAuthTokenIssuance_grant_created_idx" ON "OAuthTokenIssuance"("grantId", "createdAt");
CREATE UNIQUE INDEX "OAuthRefreshLineage_one_active_per_grant_key" ON "OAuthRefreshLineage"("grantId") WHERE "retiredAt" IS NULL;
CREATE INDEX "OAuthRefreshLineage_expiresAt_idx" ON "OAuthRefreshLineage"("expiresAt");
CREATE INDEX "OAuthRefreshLineage_retiredAt_idx" ON "OAuthRefreshLineage"("retiredAt");
