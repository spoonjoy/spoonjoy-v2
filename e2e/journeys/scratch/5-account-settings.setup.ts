// Scratch index 5: Account settings (per-device twins). Used by account-settings.journey.ts.
// One file per index, so pull requests that add journey areas never edit the same file; see
// support/scratch-setup.ts.
import { test as setup } from "../support/journey";
import { signInScratchAndSave, signInScratchDesktopAndSave } from "../support/scratch-setup";

setup("scratch 5", async ({ page }) => {
  await signInScratchAndSave(page, 5);
});

setup("scratch 5 desktop", async ({ page }) => {
  await signInScratchDesktopAndSave(page, 5);
});
