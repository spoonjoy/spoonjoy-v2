import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("a filter badge toggles aria-pressed", async ({ page }) => {
  await openStory(page, "display-badge--in-context");
  const vegan = page.getByRole("button", { name: "Vegan" });
  await expect(vegan).toHaveAttribute("aria-pressed", "false");
  await vegan.click();
  await expect(vegan).toHaveAttribute("aria-pressed", "true");
});

test("a tag badge navigates", async ({ page }) => {
  await openStory(page, "display-badge--in-context");
  await page.getByRole("link", { name: "Winter" }).click();
  await expect(page).toHaveURL(/#winter$/);
});
