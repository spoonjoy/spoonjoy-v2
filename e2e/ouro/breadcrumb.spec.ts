import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("a breadcrumb links its trail and marks the last item as the current page", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openStory(page, "navigation-breadcrumb--in-context");
  const trail = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(trail.getByText("Short ribs")).toHaveAttribute("aria-current", "page");
  await trail.getByRole("link", { name: "Recipes" }).click();
  await expect(page).toHaveURL(/#recipes$/);
});

test("a long breadcrumb opens its hidden steps from the keyboard and follows one", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openStory(page, "navigation-breadcrumb--in-context");
  const trail = page.getByRole("navigation", { name: "Editing" });
  await expect(trail.getByRole("link", { name: "Winter" })).toHaveCount(0);
  await trail.getByRole("button", { name: "More" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem")).toHaveText(["Cookbooks", "Winter", "Braises"]);
  await page.getByRole("menuitem", { name: "Winter" }).click();
  await expect(page).toHaveURL(/#winter$/);
  await expect(page.getByRole("menu")).toBeHidden();
});
