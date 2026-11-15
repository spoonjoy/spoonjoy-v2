-- Account activity: when each account was last seen (authenticated use, moved at most hourly)
-- and last signed in, with the method (app/lib/account-activity.server.ts). Read by
-- scripts/account-activity.ts so agents can tell whether a person has got back in.
--
-- Additive and nullable. Reversible: only the account-activity code names these columns, so
-- rolling back is
--   ALTER TABLE "User" DROP COLUMN "lastSignInMethod";
--   ALTER TABLE "User" DROP COLUMN "lastSignInAt";
--   ALTER TABLE "User" DROP COLUMN "lastSeenAt";
-- and the previous Worker never names them.
ALTER TABLE "User" ADD COLUMN "lastSeenAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "lastSignInAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "lastSignInMethod" TEXT;
