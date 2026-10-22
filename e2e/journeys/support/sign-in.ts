// Shared "drive the real login form" step, used by both the personas setup (which then saves
// the resulting storage state) and any journey that needs its own fresh, single-owner session
// instead of reusing a shared one (see sign-in.journey.ts's logout test).
import type { Page } from "@playwright/test";
import { expect } from "./journey";
import { persona, scratch, scratchDesktop, type PersonaName } from "./personas";
import { fillSecret, type Secret } from "./secret";
import { requiredLabel } from "./forms";
import { waitForHydration } from "./navigation";

// The login page is ready once React Router has hydrated it, which is its own signal; the
// window's load event can wait on a subresource the form never needs (in spoonjoy/spoonjoy-v2#567's
// CI, the personas setup sat out its whole 60 s timeout on a fully drawn login page). When a
// journey fails, journey.ts attaches the requests still open, so the next one names the resource.
async function submitLoginForm(page: Page, user: { username: string; password: Secret }): Promise<void> {
  await page.goto("/login", { waitUntil: "commit" });
  await waitForHydration(page);
  await page.getByLabel("Username or email").fill(user.username);
  await fillSecret(page.getByLabel(requiredLabel("Password"), { exact: true }), user.password);
  // The desktop header also has a "Log in" menu button; the form's submit is the one in <main>.
  await page.getByRole("main").getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/recipes(?:[?#].*)?$/);
}

export async function signInThroughForm(page: Page, name: PersonaName): Promise<void> {
  await submitLoginForm(page, persona(name));
}

// Same form-driving step as signInThroughForm, for a per-run scratch user (see
// support/personas.ts's scratch(n)) instead of a shared persona — used by personas.setup.ts to
// save each scratch index's session, and available to any journey that needs its own fresh
// scratch sign-in instead of the stored one.
export async function signInScratchThroughForm(page: Page, n: number): Promise<void> {
  await submitLoginForm(page, scratch(n));
}

// Same again for scratch index n's desktop twin (support/personas.ts's scratchDesktop(n)), used
// by personas.setup.ts to save each twin's session.
export async function signInScratchDesktopThroughForm(page: Page, n: number): Promise<void> {
  await submitLoginForm(page, scratchDesktop(n));
}
