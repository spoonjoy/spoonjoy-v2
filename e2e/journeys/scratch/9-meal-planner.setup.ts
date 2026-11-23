// Scratch index 9: Meal planner (per-device twins). Used by meal-planner.journey.ts, which is still to land.
// One file per index, so pull requests that add journey areas never edit the same file; see
// support/scratch-setup.ts.
import { test as setup } from "../support/journey";
import { signInScratchAndSave, signInScratchDesktopAndSave } from "../support/scratch-setup";

setup("scratch 9", async ({ page }) => {
  await signInScratchAndSave(page, 9);
});

setup("scratch 9 desktop", async ({ page }) => {
  await signInScratchDesktopAndSave(page, 9);
});
