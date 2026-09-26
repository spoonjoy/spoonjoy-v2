// Signs in each QA kitchen persona once, through the real login form, and saves its storage
// state for the journey projects to reuse. Three explicit setup blocks, each calling the one
// top-level `signInAndSave` helper — never a loop that creates setup blocks or drives clicks,
// so a single stuck persona fails on its own line instead of hiding inside iteration.
//
// This project runs on devices["Desktop Chrome"] (see playwright.journeys.config.ts); the
// storage state it writes is reused as-is by the iphone-webkit project, since cookies are
// engine-independent.
import type { Page } from "@playwright/test";
import { test as setup, expect } from "./support/journey";
import { persona, type PersonaName } from "./support/personas";

async function signInAndSave(page: Page, name: PersonaName): Promise<void> {
  const user = persona(name);
  await page.goto("/login");
  await page.getByLabel("Username or email").fill(user.username);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log In", exact: true }).click();
  await expect(page).toHaveURL(/\/recipes(?:[?#].*)?$/);
  await page.context().storageState({ path: user.storageState });
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
