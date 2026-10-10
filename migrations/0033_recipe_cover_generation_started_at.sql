-- When the cover last entered generation. A cover still processing long after this is treated as
-- stopped (its job died) and is failed when it is next read. NULL means the cover was created
-- processing and never re-entered generation, so its createdAt is the start.
ALTER TABLE "RecipeCover" ADD COLUMN "generationStartedAt" DATETIME;
