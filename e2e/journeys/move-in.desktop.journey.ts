// Move in on desktop, as the desktop twins of scratch indices 11 to 13 (e2e/journeys/scratch/), each
// a fresh account of its own. The v1.12.0 and v2.8.0 kitchens move in once each from their backups.
// The v3.31.0 kitchen moves in twice into the same account: first from a stand-in of its own server,
// with an address and token, then from its backup. The second time adds nothing, says everything was
// already here, and still says so after a reload, and the kitchen holds one copy of its recipe, not two.
// A backup of over 200 MB whose connection drops partway carries on after a reload, in the index 11
// account after its kitchen moved in, and one stopped with Stop upload starts over from its first
// part. The base accounts of the same indices run move-in.mobile.journey.ts. Helpers:
// support/move-in.ts.
import { expect, test } from "./support/journey";
import { inTheKitchen, moveIn, moveInAfterADrop, moveInAgain, serverTest, stopAndStartAgain } from "./support/move-in";
import { timeLargeMoveIn } from "./support/move-in-timing";
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

  // Then a big kitchen, timed: the proof's 500-recipe v3.31.0 kitchen, with its own ids, moves into the same account,
  // and the time it takes goes in the run's summary. It shares this account so the run signs in no more accounts.
  // Only the daily and hand-started Journeys runs include it (tag @move-in-timed; see journeys.yml).
  test("then moves a 500-recipe kitchen in, and reports how long it took @mutates", { tag: "@move-in-timed" }, async ({ page, verifyAfterReload }) => {
    await verifyAfterReload(await timeLargeMoveIn("v3.31.0", { page }));
  });
});

test.describe("Move in, the same v3.31.0 kitchen from its server and then its backup", { tag: "@move-in" }, () => {
  test.use({ storageState: scratchDesktopStorageStatePath(13) });

  serverTest("the backup adds nothing the server brought, even after a reload @mutates", async ({ page, expectAccessible, verifyAfterReload, recipeServer }) => {
    test.setTimeout(5 * 150_000);
    const server = await recipeServer("v3.31.0");
    await verifyAfterReload(await moveIn("v3.31.0", { page, expectAccessible }, { from: server }));
    // The recipes came from the server, asked for one at a time.
    expect([...server.asked.keys()].filter((path) => path.startsWith("/api/recipes/")).length).toBeGreaterThan(0);
    await verifyAfterReload(await moveInAgain("v3.31.0", { page }));
    await inTheKitchen("v3.31.0", { page, verifyAfterReload });
  });
});

test.describe("Move in, a big v1.12.0 backup over a connection that drops", { tag: "@move-in" }, () => {
  test.use({ storageState: scratchDesktopStorageStatePath(11) });

  test("carries on from the parts that arrived after a reload @mutates", async ({ page, expectConsoleError, verifyAfterReload }) => {
    await verifyAfterReload(await moveInAfterADrop("v1.12.0", { page, expectConsoleError }));
  });

  test("stops on the cook's word, and the same file then starts over from its first part @mutates", async ({ page, expectAccessible, expectConsoleError, verifyAfterReload }) => {
    await verifyAfterReload(await stopAndStartAgain("v1.12.0", { page, expectAccessible, expectConsoleError }));
  });
});
