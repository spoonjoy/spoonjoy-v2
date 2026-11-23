// Scratch index 8: Cook-session sync across devices (desktop twin only). Used by cook-session-sync.desktop.journey.ts.
// One file per index, so pull requests that add journey areas never edit the same file; see
// support/scratch-setup.ts.
import { test as setup } from "../support/journey";
import { signInScratchAndSave, signInScratchDesktopAndSave } from "../support/scratch-setup";

setup("scratch 8", async ({ page }) => {
  await signInScratchAndSave(page, 8);
});

setup("scratch 8 desktop", async ({ page }) => {
  await signInScratchDesktopAndSave(page, 8);
});
