// Scratch index 16: Move in from another Spoonjoy: the base account is the cook on the other Spoonjoy, the desktop twin moves its kitchen in.
// Used by move-in.desktop.journey.ts (support/move-in-spoonjoy.ts). One file per index, so pull
// requests that add journey areas never edit the same file; see support/scratch-setup.ts.
import { test as setup } from "../support/journey";
import { signInScratchAndSave, signInScratchDesktopAndSave } from "../support/scratch-setup";

setup("scratch 16", async ({ page }) => {
  await signInScratchAndSave(page, 16);
});

setup("scratch 16 desktop", async ({ page }) => {
  await signInScratchDesktopAndSave(page, 16);
});
