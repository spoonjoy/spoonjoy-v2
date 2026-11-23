// Scratch index 6: Sessions (revocation). Used by sessions.desktop.journey.ts.
// One file per index, so pull requests that add journey areas never edit the same file; see
// support/scratch-setup.ts.
import { test as setup } from "../support/journey";
import { signInScratchAndSave, signInScratchDesktopAndSave } from "../support/scratch-setup";

setup("scratch 6", async ({ page }) => {
  await signInScratchAndSave(page, 6);
});

setup("scratch 6 desktop", async ({ page }) => {
  await signInScratchDesktopAndSave(page, 6);
});
