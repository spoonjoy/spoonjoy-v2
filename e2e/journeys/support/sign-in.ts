// Shared "drive the real login form" step, used by both the personas setup (which then saves
// the resulting storage state) and any journey that needs its own fresh, single-owner session
// instead of reusing a shared one (see sign-in.journey.ts's logout test).
import type { Page } from "@playwright/test";
import { expect } from "./journey";
import { persona, type PersonaName } from "./personas";

export async function signInThroughForm(page: Page, name: PersonaName): Promise<void> {
  const user = persona(name);
  await page.goto("/login");
  await page.getByLabel("Username or email").fill(user.username);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log In", exact: true }).click();
  await expect(page).toHaveURL(/\/recipes(?:[?#].*)?$/);
}
