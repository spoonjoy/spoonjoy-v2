-- Household shopping lists (app/domains/pantry-and-shopping): a household's shared lists, apart from each cook's own
-- list. Everyone in the household reads them; members and owners change them. Items are what to buy, as written.
--
-- Additive. Reversible: only the household lists code names these tables, so rolling back is
--   DROP TABLE "HouseholdListItem"; DROP TABLE "HouseholdList";
-- and the previous Worker never names them.
CREATE TABLE "HouseholdList" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HouseholdList_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HouseholdList_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "HouseholdList_householdId_idx" ON "HouseholdList"("householdId");

CREATE TABLE "HouseholdListItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" DATETIME,
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    "addedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HouseholdListItem_listId_fkey" FOREIGN KEY ("listId") REFERENCES "HouseholdList" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HouseholdListItem_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "HouseholdListItem_listId_sortIndex_idx" ON "HouseholdListItem"("listId", "sortIndex");
