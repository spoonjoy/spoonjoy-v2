ALTER TABLE "RecipeCover" ADD COLUMN "promptAddition" TEXT;
ALTER TABLE "RecipeCover" ADD COLUMN "parentCoverId" TEXT;

CREATE INDEX "RecipeCover_parentCoverId_idx" ON "RecipeCover"("parentCoverId");
