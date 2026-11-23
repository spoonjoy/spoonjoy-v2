// Scratch index 1: Recipe editing. Used by recipe-editing.journey.ts.
// One file per index, so pull requests that add journey areas never edit the same file; see
// support/scratch-setup.ts.
import { test as setup } from "../support/journey";
import { signInScratchAndSave, signInScratchDesktopAndSave } from "../support/scratch-setup";

setup("scratch 1", async ({ page }) => {
  await signInScratchAndSave(page, 1);
});

setup("scratch 1 desktop", async ({ page }) => {
  await signInScratchDesktopAndSave(page, 1);
});
