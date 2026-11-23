// Scratch index 2: Cookbooks. Used by cookbooks.journey.ts.
// One file per index, so pull requests that add journey areas never edit the same file; see
// support/scratch-setup.ts.
import { test as setup } from "../support/journey";
import { signInScratchAndSave, signInScratchDesktopAndSave } from "../support/scratch-setup";

setup("scratch 2", async ({ page }) => {
  await signInScratchAndSave(page, 2);
});

setup("scratch 2 desktop", async ({ page }) => {
  await signInScratchDesktopAndSave(page, 2);
});
