// Spoonjoy: the local fixture fails a spec on any browser warning or error (e2e/fixtures.ts).
import { expect, test } from "../fixtures";
import { openStory } from "./story";

test("the password toggle shows the password and keeps typing in place", async ({ page }) => {
  await openStory(page, "forms-textfield--types");
  const password = page.getByLabel("Password", { exact: true });
  await expect(password).toHaveAttribute("type", "password");
  await password.click();
  await password.press("End");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toBeFocused();
  await expect(page.getByRole("button", { name: "Show password" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.type("!");
  await expect(password).toHaveValue("pasta-night!");
});

test("each type sets the keyboard and autofill", async ({ page }) => {
  await openStory(page, "forms-textfield--types");
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveAttribute("inputmode", "email");
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveAttribute("autocomplete", "email");
  await expect(page.getByRole("textbox", { name: "Phone" })).toHaveAttribute("inputmode", "tel");
  await expect(page.getByRole("searchbox", { name: "Search recipes" })).toHaveAttribute("inputmode", "search");
});

test("clear empties the field and puts focus back in it", async ({ page }) => {
  await openStory(page, "forms-textfield--adornments");
  const search = page.getByRole("searchbox", { name: "Search recipes" });
  await expect(search).toHaveValue("Pasta");
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(page.getByRole("button", { name: "Clear" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Price" })).toHaveAccessibleDescription("$ per jar");
});
