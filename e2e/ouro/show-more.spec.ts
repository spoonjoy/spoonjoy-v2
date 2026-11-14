import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("show more reveals the rest of a list and focuses the first new item", async ({ page }) => {
  await openStory(page, "lists-showmore--in-context");
  const list = page.getByRole("list");
  await expect(list.getByRole("listitem")).toHaveCount(4);
  await page.getByRole("button", { name: "Show more" }).last().click();
  await expect(list.getByRole("listitem")).toHaveCount(9);
  await expect(page.getByRole("link", { name: "Tomato and white bean soup" })).toBeFocused();
  await page.getByRole("button", { name: "Show less" }).last().click();
  await expect(list.getByRole("listitem")).toHaveCount(4);
});

test("show more loads the next page and focuses its first item", async ({ page }) => {
  await openStory(page, "lists-showmore--load-more");
  await page.getByRole("link", { name: "Show more" }).click();
  await expect(page.getByRole("link", { name: "Weeknight dal" })).toBeFocused();
  await expect(page.locator("[data-ouro-show-more-status]")).toHaveText("Showing 6 recipes");
  await expect(page).not.toHaveURL(/after=/);
});

test("show more unfolds a long post, and show less folds it again", async ({ page }) => {
  await openStory(page, "lists-showmore--long-post");
  const fold = page.locator("[data-ouro-show-more-fold]");
  await expect(fold).toHaveAttribute("data-folded", "");
  await page.getByRole("button", { name: "Show more" }).click();
  await expect(fold).not.toHaveAttribute("data-folded");
  await expect(page.getByRole("link", { name: "Sign up for a dish" })).toBeInViewport();
  await page.getByRole("button", { name: "Show less" }).click();
  await expect(fold).toHaveAttribute("data-folded", "");
});
