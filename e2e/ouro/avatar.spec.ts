import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("an avatar shows its picture once loaded and its initials without one", async ({ page }) => {
  await openStory(page, "display-avatar--sizes");
  const ada = page.getByRole("img", { name: "Ada Lovelace" }).first();
  await expect(ada.locator("img")).toBeVisible();
  const grace = page.getByRole("img", { name: "Grace Hopper" }).first();
  await expect(grace).toHaveText("GH");
});

test("a group shows max avatars and says how many more", async ({ page }) => {
  await openStory(page, "display-avatar--group");
  const cooks = page.getByRole("group", { name: "Cooks on this recipe" });
  await expect(cooks.getByRole("img")).toHaveCount(3);
  await expect(cooks).toContainText("2 more");
});
