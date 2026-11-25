// Scratch index 15: Household meal plan (per-device twins). Used by household-plan.journey.ts.
// One file per index, so pull requests that add journey areas never edit the same file; see
// support/scratch-setup.ts.
import { test as setup } from "../support/journey";
import { signInScratchAndSave, signInScratchDesktopAndSave } from "../support/scratch-setup";

setup("scratch 15", async ({ page }) => {
  await signInScratchAndSave(page, 15);
});

setup("scratch 15 desktop", async ({ page }) => {
  await signInScratchDesktopAndSave(page, 15);
});
