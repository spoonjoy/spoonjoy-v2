-- Refresh tokens get an expiry (security audit 2026-10-09, finding 6). Each rotation issues a new
-- refresh token with a fresh 180-day window, so a connection only lapses after 180 days without a
-- refresh.
--
-- This migration only adds the column, so the release can apply it automatically. Rows that
-- predate it keep "expiresAt" NULL, and the Worker gives them a fixed cutover instead of a data
-- backfill: legacy refresh tokens are accepted until 2027-04-07 and legacy MCP access tokens until
-- 2027-01-07 (LEGACY_OAUTH_REFRESH_EXPIRES_AT and LEGACY_OAUTH_ACCESS_EXPIRES_AT). Personal and
-- delegated API tokens keep the expiry their owners chose.
ALTER TABLE "OAuthRefreshToken" ADD COLUMN "expiresAt" DATETIME;
