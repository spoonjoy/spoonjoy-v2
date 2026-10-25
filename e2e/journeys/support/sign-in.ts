// Shared "drive the real login form" step, used by both the personas setup (which then saves
// the resulting storage state) and any journey that needs its own fresh, single-owner session
// instead of reusing a shared one (see sign-in.journey.ts's logout test).
import type { Page, Response } from "@playwright/test";
import { expect } from "./journey";
import { persona, scratch, scratchDesktop, type PersonaName } from "./personas";
import { fillSecret, type Secret } from "./secret";
import { requiredLabel } from "./forms";

async function submitLoginForm(page: Page, user: { username: string; password: Secret }): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username or email").fill(user.username);
  await fillSecret(page.getByLabel(requiredLabel("Password"), { exact: true }), user.password);
  // Waits for the login action's own answer before the URL, so a failed sign-in says whether the
  // Worker answered and with what status (429 is the sign-in rate limit), instead of only that the
  // page was still on /login 5 s after the tap (run 40235473342's "scratch 7" setup).
  const answered = page.waitForResponse(isLoginAction);
  // The desktop header also has a "Log in" menu button; the form's submit is the one in <main>.
  await page.getByRole("main").getByRole("button", { name: "Log in", exact: true }).click();
  const response = await answered;
  expect(response.status(), `the login action answered ${response.status()}`).toBeLessThan(400);
  await expect(page).toHaveURL(/\/recipes(?:[?#].*)?$/);
}

// The login form's POST: /login.data when the app submits it, /login when the browser does.
function isLoginAction(response: Response): boolean {
  return response.request().method() === "POST" && /^\/login(?:\.data)?$/.test(new URL(response.url()).pathname);
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
