// Scratch index 13: Move in, one fresh kitchen each: v3.31.0 on iPhone (base account), the same backup moved in twice on desktop (twin).
// Used by move-in.mobile.journey.ts and move-in.desktop.journey.ts. One file per index, so pull
// requests that add journey areas never edit the same file; see support/scratch-setup.ts.
import { test as setup } from "../support/journey";
import { signInScratchAndSave, signInScratchDesktopAndSave } from "../support/scratch-setup";

setup("scratch 13", async ({ page }) => {
  await signInScratchAndSave(page, 13);
});

setup("scratch 13 desktop", async ({ page }) => {
  await signInScratchDesktopAndSave(page, 13);
});
