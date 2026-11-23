// Scratch index 11: Move in, one fresh kitchen each: v1.12.0 on iPhone (base account), v1.12.0 on desktop (twin).
// Used by move-in.mobile.journey.ts and move-in.desktop.journey.ts. One file per index, so pull
// requests that add journey areas never edit the same file; see support/scratch-setup.ts.
import { test as setup } from "../support/journey";
import { signInScratchAndSave, signInScratchDesktopAndSave } from "../support/scratch-setup";

setup("scratch 11", async ({ page }) => {
  await signInScratchAndSave(page, 11);
});

setup("scratch 11 desktop", async ({ page }) => {
  await signInScratchDesktopAndSave(page, 11);
});
