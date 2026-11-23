// Scratch index 10: Households (twins). Used by households.desktop.journey.ts.
// One file per index, so pull requests that add journey areas never edit the same file; see
// support/scratch-setup.ts.
import { test as setup } from "../support/journey";
import { signInScratchAndSave, signInScratchDesktopAndSave } from "../support/scratch-setup";

setup("scratch 10", async ({ page }) => {
  await signInScratchAndSave(page, 10);
});

setup("scratch 10 desktop", async ({ page }) => {
  await signInScratchDesktopAndSave(page, 10);
});
