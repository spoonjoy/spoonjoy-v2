-- Each job's message, kept on its key while the job waits or runs, so a self-hosted server can send it
-- again when it starts: its queue lives in the server's memory and a restart loses what it held
-- (replayJobMessages in app/domains/platform/adapters/cloudflare-jobs.server.ts). Cloudflare Queues keep
-- their own messages, so spoonjoy.app only writes these columns.
--
-- Reversible: nothing but the replay reads them, so rolling back is
--   ALTER TABLE "PlatformJobKey" DROP COLUMN "payload";
--   ALTER TABLE "PlatformJobKey" DROP COLUMN "deliverAt";
ALTER TABLE "PlatformJobKey" ADD COLUMN "payload" TEXT;
ALTER TABLE "PlatformJobKey" ADD COLUMN "deliverAt" DATETIME;
