-- Credentials stop working forever by default (security audit 2026-10-09, finding 6).
--
-- 1. Refresh tokens get an expiry. Each rotation issues a new refresh token with a fresh 180-day
--    window, so a connection only lapses after 180 days without a refresh.
ALTER TABLE "OAuthRefreshToken" ADD COLUMN "expiresAt" DATETIME;

-- Existing active refresh tokens start their 180-day window now rather than from when they were
-- issued, so no current connection lapses because of this migration.
UPDATE "OAuthRefreshToken"
SET "expiresAt" = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+180 days')
WHERE "revokedAt" IS NULL AND "expiresAt" IS NULL;

-- 2. MCP-bound OAuth access tokens (the Claude connector) were issued with no expiry. They now
--    last 90 days and the client refreshes them; existing ones get 90 days from now. Personal and
--    delegated API tokens (no oauthClientId) are left as their owners created them.
--
-- To reverse step 2, clear "expiresAt" on OAuth access credentials whose expiry equals the
-- timestamp this statement wrote (they all share it).
UPDATE "ApiCredential"
SET "expiresAt" = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+90 days')
WHERE "oauthClientId" IS NOT NULL AND "expiresAt" IS NULL AND "revokedAt" IS NULL;
