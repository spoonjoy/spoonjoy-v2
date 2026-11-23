// Scratch index 3: Shopping list (per-device twins). Used by shopping-list.journey.ts, shopping-list.mobile.journey.ts.
// One file per index, so pull requests that add journey areas never edit the same file; see
// support/scratch-setup.ts.
import { test as setup } from "../support/journey";
import { signInScratchAndSave, signInScratchDesktopAndSave } from "../support/scratch-setup";

setup("scratch 3", async ({ page }) => {
  await signInScratchAndSave(page, 3);
});

setup("scratch 3 desktop", async ({ page }) => {
  await signInScratchDesktopAndSave(page, 3);
});
