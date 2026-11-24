// Move in on iPhone: each source version's small kitchen moves into its own fresh account, scratch
// indices 11 to 13's base accounts (e2e/journeys/scratch/), so no version sees another's recipes.
// Each finishes with every recipe and photo the proof's manifest counts, still there after a reload,
// and one of its recipes is in the kitchen once, with its photo and steps. The desktop twins of the
// same indices run move-in.desktop.journey.ts. Helpers: support/move-in.ts.
import { test } from "./support/journey";
import { inTheKitchen, moveIn } from "./support/move-in";
import { scratchStorageStatePath } from "./support/personas";

test.describe("Move in, a v1.12.0 kitchen", { tag: "@move-in" }, () => {
  test.use({ storageState: scratchStorageStatePath(11) });

  test("moves in with every recipe and photo @mutates", async ({ page, expectAccessible, verifyAfterReload }) => {
    await verifyAfterReload(await moveIn("v1.12.0", { page, expectAccessible }));
    await inTheKitchen("v1.12.0", { page, verifyAfterReload });
  });
});

test.describe("Move in, a v2.8.0 kitchen", { tag: "@move-in" }, () => {
  test.use({ storageState: scratchStorageStatePath(12) });

  test("moves in with every recipe and photo @mutates", async ({ page, expectAccessible, verifyAfterReload }) => {
    await verifyAfterReload(await moveIn("v2.8.0", { page, expectAccessible }));
    await inTheKitchen("v2.8.0", { page, verifyAfterReload });
  });
});

test.describe("Move in, a v3.31.0 kitchen", { tag: "@move-in" }, () => {
  test.use({ storageState: scratchStorageStatePath(13) });

  test("moves in with every recipe and photo @mutates", async ({ page, expectAccessible, verifyAfterReload }) => {
    await verifyAfterReload(await moveIn("v3.31.0", { page, expectAccessible }));
    await inTheKitchen("v3.31.0", { page, verifyAfterReload });
  });
});
