// Scratch index 14: Password reset (twins). Used by password-reset.journey.ts, which resets each
// account's password from the reset mail QA captured, so no other journey may use this index.
// One file per index, so pull requests that add journey areas never edit the same file; see
// support/scratch-setup.ts.
import { test as setup } from "../support/journey";
import { signInScratchAndSave, signInScratchDesktopAndSave } from "../support/scratch-setup";

setup("scratch 14", async ({ page }) => {
  await signInScratchAndSave(page, 14);
});

setup("scratch 14 desktop", async ({ page }) => {
  await signInScratchDesktopAndSave(page, 14);
});
