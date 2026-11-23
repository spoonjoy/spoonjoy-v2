// Scratch index 7: Cooking progress (per-device twins). Used by cooking.journey.ts (its progress tests).
// One file per index, so pull requests that add journey areas never edit the same file; see
// support/scratch-setup.ts.
import { test as setup } from "../support/journey";
import { signInScratchAndSave, signInScratchDesktopAndSave } from "../support/scratch-setup";

setup("scratch 7", async ({ page }) => {
  await signInScratchAndSave(page, 7);
});

setup("scratch 7 desktop", async ({ page }) => {
  await signInScratchDesktopAndSave(page, 7);
});
