// Move in on desktop, as the desktop twins of scratch indices 11 to 13 (e2e/journeys/scratch/), each
// a fresh account of its own. The v1.12.0 and v2.8.0 kitchens move in once each. The v3.31.0 kitchen
// moves in twice into the same account: the second time adds nothing, says everything was already
// here, and still says so after a reload, and the kitchen holds one copy of its recipe, not two.
// The base accounts of the same indices run move-in.mobile.journey.ts. Helpers: support/move-in.ts.
import { test } from "./support/journey";
import { inTheKitchen, moveIn, moveInAgain } from "./support/move-in";
import { scratchDesktopStorageStatePath } from "./support/personas";

test.describe("Move in, a v1.12.0 kitchen", { tag: "@move-in" }, () => {
  test.use({ storageState: scratchDesktopStorageStatePath(11) });

  test("moves in with every recipe and photo @mutates", async ({ page, expectAccessible, verifyAfterReload }) => {
    await verifyAfterReload(await moveIn("v1.12.0", { page, expectAccessible }));
    await inTheKitchen("v1.12.0", { page, verifyAfterReload });
  });
});

test.describe("Move in, a v2.8.0 kitchen", { tag: "@move-in" }, () => {
  test.use({ storageState: scratchDesktopStorageStatePath(12) });

  test("moves in with every recipe and photo @mutates", async ({ page, expectAccessible, verifyAfterReload }) => {
    await verifyAfterReload(await moveIn("v2.8.0", { page, expectAccessible }));
    await inTheKitchen("v2.8.0", { page, verifyAfterReload });
  });
});

test.describe("Move in, the same v3.31.0 kitchen twice", { tag: "@move-in" }, () => {
  test.use({ storageState: scratchDesktopStorageStatePath(13) });

  test("the second move-in adds nothing, even after a reload @mutates", async ({ page, expectAccessible, verifyAfterReload }) => {
    test.setTimeout(5 * 150_000);
    await verifyAfterReload(await moveIn("v3.31.0", { page, expectAccessible }));
    await verifyAfterReload(await moveInAgain("v3.31.0", { page }));
    await inTheKitchen("v3.31.0", { page, verifyAfterReload });
  });
});
