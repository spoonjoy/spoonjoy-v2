// Signs in a per-run scratch user (scripts/seed-qa-kitchen.mjs) through the real login form and
// saves its session for the journeys. Each scratch index has its own file in ../scratch/, named
// `<n>-<area>.setup.ts`, with two explicit setup blocks: the base account and its desktop twin.
// A new journey area adds the next file; the seed counts the files, so nothing else changes.
// The "personas" project runs these with personas.setup.ts (playwright.journeys.config.ts).
import type { Page } from "@playwright/test";
import { scratchDesktopStorageStatePath, scratchStorageStatePath } from "./personas";
import { signInScratchDesktopThroughForm, signInScratchThroughForm } from "./sign-in";

export async function signInScratchAndSave(page: Page, n: number): Promise<void> {
  await signInScratchThroughForm(page, n);
  await page.context().storageState({ path: scratchStorageStatePath(n) });
}

export async function signInScratchDesktopAndSave(page: Page, n: number): Promise<void> {
  await signInScratchDesktopThroughForm(page, n);
  await page.context().storageState({ path: scratchDesktopStorageStatePath(n) });
}
