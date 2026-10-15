import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("a group is a named list of its rows", async ({ page }) => {
  await openStory(page, "lists-itemgroup--in-context");
  const list = page.getByRole("list", { name: "Recently cooked" });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await list.getByRole("link", { name: "Lemon pasta" }).click();
  await expect(page).toHaveURL(/#lemon-pasta$/);
});

test("an empty group shows its empty message and no list", async ({ page }) => {
  await openStory(page, "lists-itemgroup--in-context");
  await expect(page.getByText("No active OAuth app connections.")).toBeVisible();
  await expect(page.getByRole("list", { name: "OAuth app connections" })).toHaveCount(0);
});
