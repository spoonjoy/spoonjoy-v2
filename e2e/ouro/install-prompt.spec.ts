import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("the install offer shows when the browser offers, and Not now puts it away until the next visit", async ({ page }) => {
  await openStory(page, "feedback-installprompt--in-context");
  await expect(page.getByRole("heading", { name: "Take your notes offline" })).toBeVisible();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByRole("heading", { name: "Take your notes offline" })).toBeHidden();
  expect(Number(await page.evaluate(() => localStorage.getItem("ouro-install-dismissed")))).toBeGreaterThan(0);
});

test("Install opens the browser's dialog and the offer goes away", async ({ page }) => {
  await openStory(page, "feedback-installprompt--in-context");
  await page.getByRole("button", { name: "Install Field Notes" }).click();
  await expect(page.getByRole("heading", { name: "Take your notes offline" })).toBeHidden();
});
