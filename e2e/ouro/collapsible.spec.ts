import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("a collapsible opens and closes under its title", async ({ page }) => {
  await openStory(page, "lists-collapsible--in-context");
  const title = page.getByRole("button", { name: "Nutrition facts" });
  await expect(title).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("[data-ouro-collapsible-panel]").first()).toHaveAttribute("hidden", /.*/);
  await title.click();
  await expect(title).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("420 calories")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(title).toHaveAttribute("aria-expanded", "false");
});
