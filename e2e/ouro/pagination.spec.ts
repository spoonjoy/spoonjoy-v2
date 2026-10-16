import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("pagination links go to each page's address and mark the current page", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openStory(page, "navigation-pagination--in-context");
  const nav = page.getByRole("navigation", { name: "Pagination" });
  await expect(nav.getByRole("link", { name: "Page 6", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Next" })).toHaveAttribute("href", "?page=7");
  await nav.getByRole("link", { name: "Page 12", exact: true }).click();
  await expect(page).toHaveURL(/[?&]page=12$/);
});

test("pagination buttons change the page in place and stop at the ends", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openStory(page, "navigation-pagination--buttons");
  const nav = page.getByRole("navigation", { name: "Pagination" });
  await expect(nav.getByRole("button", { name: "Previous" })).toBeDisabled();
  await nav.getByRole("button", { name: "Next" }).click();
  await expect(nav.getByRole("button", { name: "Page 2", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Showing page 2")).toBeVisible();
  await nav.getByRole("button", { name: "Page 5", exact: true }).click();
  await expect(nav.getByRole("button", { name: "Next" })).toBeDisabled();
});

test("on a phone pagination shows Previous, the page of pages, and Next", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStory(page, "navigation-pagination--in-context");
  const nav = page.getByRole("navigation", { name: "Pagination" });
  await expect(nav.getByText("Page 6 of 12")).toBeVisible();
  await expect(nav.getByRole("link", { name: "Page 6", exact: true })).toBeHidden();
  await expect(nav.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "?page=5");
});
