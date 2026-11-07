-- Cooking now: the recipes a cook has in progress, one row per (user, recipe), for
-- GET /api/v1/cooking-now. The Worker writes a row after every cook-session start or progress
-- write (app/lib/cooking-now.server.ts); the CookSession Durable Object stays the server of
-- record for progress, so this table is derived and can be dropped and rebuilt at any time.
-- Times are epoch milliseconds.
--
-- Reversible: nothing but the cooking-now writer and reader uses this table, so rolling back is
--   DROP TABLE "CookingNow";
-- and the previous Worker never names it.
CREATE TABLE "CookingNow" (
    "userId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "listed" BOOLEAN NOT NULL DEFAULT true,
    "activeStepId" TEXT,
    "activeStepIndex" INTEGER NOT NULL,
    "stepCount" INTEGER NOT NULL,
    "checkedCount" INTEGER NOT NULL,
    "totalCount" INTEGER NOT NULL,
    "allCheckedAt" BIGINT,
    "touchedAt" BIGINT NOT NULL,

    PRIMARY KEY ("userId", "recipeId"),
    CONSTRAINT "CookingNow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CookingNow_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CookingNow_userId_touchedAt_idx" ON "CookingNow"("userId", "touchedAt");
