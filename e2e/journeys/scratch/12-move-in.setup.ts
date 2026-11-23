// Scratch index 12: Move in, one fresh kitchen each: v2.8.0 on iPhone (base account), v2.8.0 on desktop (twin).
// Used by move-in.mobile.journey.ts and move-in.desktop.journey.ts. One file per index, so pull
// requests that add journey areas never edit the same file; see support/scratch-setup.ts.
import { test as setup } from "../support/journey";
import { signInScratchAndSave, signInScratchDesktopAndSave } from "../support/scratch-setup";

setup("scratch 12", async ({ page }) => {
  await signInScratchAndSave(page, 12);
});

setup("scratch 12 desktop", async ({ page }) => {
  await signInScratchDesktopAndSave(page, 12);
});
