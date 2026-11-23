-- Platform jobs (app/domains/platform/ports/jobs.ts): one row per job key, so a job is enqueued and run
-- once however often it is asked for or delivered. "pending" from enqueue until its handler finishes,
-- then "done"; a job that fails its last attempt loses its row, so it can be enqueued again.
--
-- Reversible: nothing reads this table until a job kind is enqueued, so rolling back is
--   DROP TABLE "PlatformJobKey";
-- and the previous Worker never names it.
CREATE TABLE "PlatformJobKey" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
