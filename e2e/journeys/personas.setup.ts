// Signs in each QA kitchen persona once, through the real login form, and saves its storage
// state for signed-in journeys. Three explicit setup blocks, each calling the one
// top-level `signInAndSave` helper — never a loop that creates setup blocks or drives clicks,
// so a single stuck persona fails on its own line instead of hiding inside iteration.
//
// This project runs on devices["Desktop Chrome"] (see playwright.journeys.config.ts). The
// storage state it writes is stored for signed-in journeys to start from; cookies are
// engine-independent, so journeys on either device project can reuse it.
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
