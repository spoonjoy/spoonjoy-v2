-- Account activity: last seen, last sign-in and its method (see migrations/0038_account_activity.sql).
ALTER TABLE "User" ADD COLUMN "lastSeenAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "lastSignInAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "lastSignInMethod" TEXT;
