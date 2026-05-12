-- D-006 PWA + Web Push: PushSubscription, NotificationEvent, NotificationPreference.

CREATE TABLE IF NOT EXISTS "PushSubscription" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "userId"      TEXT NOT NULL,
  "endpoint"    TEXT NOT NULL,
  "p256dh"      TEXT NOT NULL,
  "authSecret"  TEXT NOT NULL,
  "userAgent"   TEXT,
  "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX IF NOT EXISTS "PushSubscription_userId_idx" ON "PushSubscription"("userId");

CREATE TABLE IF NOT EXISTS "NotificationEvent" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "recipientId"     TEXT NOT NULL,
  "kind"            TEXT NOT NULL,
  "payload"         TEXT NOT NULL,
  "createdAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt"          DATETIME,
  "pushDeliveredAt" DATETIME,
  CONSTRAINT "NotificationEvent_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "NotificationEvent_recipientId_createdAt_idx" ON "NotificationEvent"("recipientId","createdAt");

CREATE TABLE IF NOT EXISTS "NotificationPreference" (
  "userId"                     TEXT NOT NULL PRIMARY KEY,
  "notifySpoonOnMyRecipe"      INTEGER NOT NULL DEFAULT 1,
  "notifyForkOfMyRecipe"       INTEGER NOT NULL DEFAULT 1,
  "notifyCookbookSaveOfMine"   INTEGER NOT NULL DEFAULT 1,
  "notifyFellowChefOriginCook" INTEGER NOT NULL DEFAULT 1,
  "updatedAt"                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
