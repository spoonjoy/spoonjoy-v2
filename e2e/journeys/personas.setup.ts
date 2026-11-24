// Signs in each QA kitchen persona once through the real login form and saves its storage state
// for signed-in journeys. The per-run scratch users sign in from their own files in scratch/
// (support/scratch-setup.ts), in the same "personas" project. Explicit setup blocks only — never
// a loop that creates setup blocks or drives clicks (pnpm run check:journeys' no-click-in-loop
// rule flags a click inside a loop, a .toPass() retry callback, or an array-iteration callback),
// so a single stuck persona or scratch user fails on its own line instead of hiding inside
// iteration.
//
// This project runs on devices["Desktop Chrome"] (see playwright.journeys.config.ts). The
// storage state it writes is stored for signed-in journeys to start from; cookies are
// engine-independent, so journeys on either device project can reuse it.
//
// Rate-limit budget: QA's AUTH_IP_RATE_LIMITER allows 100 sign-in/sign-up attempts per minute
// per IP (wrangler.json's `env.qa` — raised from the shared default of 20 specifically because
// CI's Journeys workflow exercises QA from shared GitHub-hosted runner IPs; see
// docs/deployment.md's Dedicated QA Environment section. Production stays at 20). The "personas"
// project performs 3 persona sign-ins plus 2 for each scratch file (a base account and a desktop
// twin), all up front, before any journey starts (every journey project depends on it).
// JOURNEY_SIGN_IN_ATTEMPTS in support/scratch-budget.ts counts what the journeys add, and
// test/scripts/journey-sign-in-budget.test.ts keeps the whole run under the cap.
import type { Page } from "@playwright/test";
import { test as setup } from "./support/journey";
import { persona, type PersonaName } from "./support/personas";
import { signInThroughForm } from "./support/sign-in";

async function signInAndSave(page: Page, name: PersonaName): Promise<void> {
  await signInThroughForm(page, name);
  await page.context().storageState({ path: persona(name).storageState });
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
