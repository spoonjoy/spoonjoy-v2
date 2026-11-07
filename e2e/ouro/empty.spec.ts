import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("an empty state names what is empty and offers the way out", async ({ page }) => {
  await openStory(page, "display-empty--in-context");
  await expect(page.getByRole("heading", { level: 3, name: "No recipes yet" })).toBeVisible();
  await page.getByRole("link", { name: "Create recipe" }).click();
  await expect(page).toHaveURL(/#new$/);
});
