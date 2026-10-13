// Spoonjoy: the local fixture fails a spec on any browser warning or error (e2e/fixtures.ts).
import { expect, test } from "../fixtures";
import { openStory } from "./story";

test("clicking a label focuses its control, which is described and marked", async ({ page }) => {
  await openStory(page, "forms-field--states");
  await page.locator("label").filter({ hasText: /^Email\*$/ }).click();
  const email = page.getByRole("textbox", { name: "Email" });
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute("aria-required", "true");
  await expect(email).toHaveAccessibleDescription("We send the shopping list here.");
  const url = page.getByRole("textbox", { name: "Source URL" });
  await expect(url).toHaveAttribute("aria-invalid", "true");
  await expect(url).toHaveAccessibleDescription("Enter a full address, starting with https://.");
  await expect(page.getByRole("textbox", { name: "Cookbook" })).toBeDisabled();
});

test("a server error for the field's name shows under it after submit", async ({ page }) => {
  await openStory(page, "forms-field--server-errors");
  const email = page.getByRole("textbox", { name: "Email" });
  await expect(email).not.toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("That email already has an account.")).toBeVisible();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toHaveAccessibleDescription("That email already has an account.");
});
