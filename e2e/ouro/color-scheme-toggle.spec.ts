import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("the color scheme toggle switches the page to dark and back, and keeps the choice", async ({ page }) => {
  await openStory(page, "actions-colorschemetoggle--in-context");
  await page.evaluate(() => localStorage.removeItem("ouro-color-scheme"));
  const html = page.locator("html");
  const trigger = page.getByRole("button", { name: "Color scheme" });
  await trigger.click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(html).toHaveClass(/\bdark\b/);
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem("ouro-color-scheme"))).toBe("dark");
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  await page.getByRole("radio", { name: "Light" }).click();
  await expect(html).not.toHaveClass(/\bdark\b/);
  await page.evaluate(() => localStorage.removeItem("ouro-color-scheme"));
});
