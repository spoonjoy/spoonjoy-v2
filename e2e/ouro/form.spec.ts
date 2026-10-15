import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("puts a server error on its field and moves focus there", async ({ page }) => {
  await openStory(page, "forms-form--server-errors");
  await page.getByRole("button", { name: "Save recipe" }).click();
  const name = page.getByRole("textbox", { name: "Name" });
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAccessibleDescription("You already have a recipe called Pasta.");
  await name.fill("Pasta bake");
  await expect(name).not.toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
});

test("stops a submit the browser's checks reject", async ({ page }) => {
  await openStory(page, "forms-form--validation");
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByRole("textbox", { name: "Email" })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveAttribute("aria-invalid", "true");
});
