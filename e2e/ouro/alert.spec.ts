import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("a destructive alert is an alert, and its close button dismisses it", async ({ page }) => {
  await openStory(page, "display-alert--with-action");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Couldn't save");
  await alert.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Show the error again" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
});

test("success, information and neutral alerts are status regions", async ({ page }) => {
  await openStory(page, "display-alert--tones");
  await expect(page.getByRole("status")).toHaveCount(3);
  await expect(page.getByRole("alert")).toHaveCount(2);
});
