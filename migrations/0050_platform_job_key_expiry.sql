-- The scheduled sweep (expireDoneJobKeys in app/domains/platform/adapters/cloudflare-jobs.server.ts) forgets
-- keys done more than 30 days ago; this index lets it find them without reading every key.
--
-- Reversible: only the sweep's lookup uses it, so rolling back is
--   DROP INDEX "PlatformJobKey_status_updatedAt_idx";
CREATE INDEX "PlatformJobKey_status_updatedAt_idx" ON "PlatformJobKey"("status", "updatedAt");
