// Shared "drive the real login form" step, used by both the personas setup (which then saves
// the resulting storage state) and any journey that needs its own fresh, single-owner session
// instead of reusing a shared one (see sign-in.journey.ts's logout test).
import type { Page } from "@playwright/test";
import { expect } from "./journey";
import { persona, scratch, scratchDesktop, type PersonaName } from "./personas";
import { fillSecret, type Secret } from "./secret";

async function submitLoginForm(page: Page, user: { username: string; password: Secret }): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username or email").fill(user.username);
  await fillSecret(page.getByLabel("Password"), user.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
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
