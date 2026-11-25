-- Smart cookbooks (app/domains/kitchen/model/smart-cookbook.ts): a cookbook a cook defines by rules, which fills
-- itself with their recipes that match. SmartCookbook belongs to its cook; its title is unique per cook. Each
-- SmartCookbookRule names one of the cook's organizers and a side, "with" or "without", in the order the cook gave them
-- ("position").
--
-- A rule's organizerId has no foreign key on purpose: when an organizer is deleted its rules stay, so a cookbook that
-- needed it fills with nothing instead of widening to every recipe.
--
-- Reversible: nothing but the smart cookbooks code uses these tables, so rolling back is
--   DROP TABLE "SmartCookbookRule"; DROP TABLE "SmartCookbook";
-- and the previous Worker never names them.
CREATE TABLE "SmartCookbook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SmartCookbook_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SmartCookbook_ownerId_title_key" ON "SmartCookbook"("ownerId", "title");

CREATE TABLE "SmartCookbookRule" (
    "cookbookId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    PRIMARY KEY ("cookbookId", "side", "organizerId"),
    CONSTRAINT "SmartCookbookRule_cookbookId_fkey" FOREIGN KEY ("cookbookId") REFERENCES "SmartCookbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SmartCookbookRule_organizerId_idx" ON "SmartCookbookRule"("organizerId");
