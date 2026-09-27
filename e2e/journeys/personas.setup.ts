// Signs in each QA kitchen persona, and each per-run scratch user, once through the real login
// form, and saves its storage state for signed-in journeys. Explicit setup blocks only, each
// calling one of the two top-level "sign in and save" helpers below — never a loop that creates
// setup blocks or drives clicks (pnpm run check:journeys' no-click-in-loop rule flags a click
// inside a loop, a .toPass() retry callback, or an array-iteration callback), so a single stuck
// persona or scratch user fails on its own line instead of hiding inside iteration.
//
// This project runs on devices["Desktop Chrome"] (see playwright.journeys.config.ts). The
// storage state it writes is stored for signed-in journeys to start from; cookies are
// engine-independent, so journeys on either device project can reuse it.
//
// Rate-limit budget: QA's AUTH_IP_RATE_LIMITER allows 60 sign-in/sign-up attempts per minute
// per IP (wrangler.json's `env.qa` — raised from the shared default of 20 specifically because
// CI's Journeys workflow exercises QA from shared GitHub-hosted runner IPs; see
// docs/deployment.md's Dedicated QA Environment section. Production stays at 20). This project
// alone performs 3 persona sign-ins + 6 scratch sign-ins = 9 attempts, all up front, before any
// journey starts (Playwright runs this "personas" project to completion first, as every
// journey project depends on it). The journeys themselves add, at most, 11 more across a full
// run: sign-in.journey.ts's 4 login submissions (username, email, wrong-password, and the
// logout test's fresh sign-in) run on both the iphone-webkit and desktop-chrome device
// projects (it is a plain *.journey.ts, not device-suffixed) for 8; round-trips.journey.ts's 1
// "log in, then redirect back" submission likewise runs on both devices for 2; and
// cooking.mobile.journey.ts's 1 /signup (the only throwaway-signup journey today) runs on
// iphone-webkit only for 1 — 8 + 2 + 1 = 11. That is a nominal 9 + 11 = 20 attempts across the
// whole run — a third of the 60/minute cap even in the worst case where every attempt somehow
// landed in the same rolling 60-second window, so there is real headroom for another
// sign-in-heavy journey or scratch index.
import type { Page } from "@playwright/test";
import { test as setup } from "./support/journey";
import { persona, scratchStorageStatePath, type PersonaName } from "./support/personas";
import { signInScratchThroughForm, signInThroughForm } from "./support/sign-in";

async function signInAndSave(page: Page, name: PersonaName): Promise<void> {
  await signInThroughForm(page, name);
  await page.context().storageState({ path: persona(name).storageState });
}

async function signInScratchAndSave(page: Page, n: number): Promise<void> {
  await signInScratchThroughForm(page, n);
  await page.context().storageState({ path: scratchStorageStatePath(n) });
}

setup("chef", async ({ page }) => {
  await signInAndSave(page, "chef");
});

setup("friend", async ({ page }) => {
  await signInAndSave(page, "friend");
});

setup("newbie", async ({ page }) => {
  await signInAndSave(page, "newbie");
});

// Scratch users: one per data-changing journey file. See AGENTS.md's Validation section for
// the assignment table (which journey file owns which index).
setup("scratch 1", async ({ page }) => {
  await signInScratchAndSave(page, 1);
});

setup("scratch 2", async ({ page }) => {
  await signInScratchAndSave(page, 2);
});

setup("scratch 3", async ({ page }) => {
  await signInScratchAndSave(page, 3);
});

setup("scratch 4", async ({ page }) => {
  await signInScratchAndSave(page, 4);
});

setup("scratch 5", async ({ page }) => {
  await signInScratchAndSave(page, 5);
});

setup("scratch 6", async ({ page }) => {
  await signInScratchAndSave(page, 6);
});
