// Scratch index 4: Social (saves, forks, cooks; per-device twins). Used by social.journey.ts.
// One file per index, so pull requests that add journey areas never edit the same file; see
// support/scratch-setup.ts.
import { test as setup } from "../support/journey";
import { signInScratchAndSave, signInScratchDesktopAndSave } from "../support/scratch-setup";

setup("scratch 4", async ({ page }) => {
  await signInScratchAndSave(page, 4);
});

setup("scratch 4 desktop", async ({ page }) => {
  await signInScratchDesktopAndSave(page, 4);
});
