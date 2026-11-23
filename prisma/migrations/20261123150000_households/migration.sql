CREATE TABLE "Household" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Household_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "HouseholdMember" (
    "householdId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL CHECK ("role" IN ('owner', 'member', 'viewer')),
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("householdId", "userId"),
    CONSTRAINT "HouseholdMember_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HouseholdMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "HouseholdMember_userId_idx" ON "HouseholdMember"("userId");

CREATE TABLE "HouseholdInvite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member' CHECK ("role" IN ('member', 'viewer')),
    "usesLeft" INTEGER NOT NULL DEFAULT 1,
    "email" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HouseholdInvite_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HouseholdInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "HouseholdInvite_tokenHash_key" ON "HouseholdInvite"("tokenHash");
CREATE INDEX "HouseholdInvite_householdId_idx" ON "HouseholdInvite"("householdId");

CREATE TRIGGER "HouseholdMember_keep_owner" AFTER DELETE ON "HouseholdMember"
WHEN OLD."role" = 'owner'
  AND NOT EXISTS (SELECT 1 FROM "HouseholdMember" WHERE "householdId" = OLD."householdId" AND "role" = 'owner')
BEGIN
    UPDATE "HouseholdMember" SET "role" = 'owner'
    WHERE "householdId" = OLD."householdId" AND "userId" = (
        SELECT "userId" FROM "HouseholdMember" WHERE "householdId" = OLD."householdId"
        ORDER BY "joinedAt", "userId" LIMIT 1
    );
END;

CREATE TRIGGER "HouseholdMember_delete_empty" AFTER DELETE ON "HouseholdMember"
WHEN NOT EXISTS (SELECT 1 FROM "HouseholdMember" WHERE "householdId" = OLD."householdId")
BEGIN
    DELETE FROM "Household" WHERE "id" = OLD."householdId";
END;
