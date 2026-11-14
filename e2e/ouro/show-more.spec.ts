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

// The browser's own notice that an observer's callback changed what it watches. WebKit raises it as a window error, so a
// zero-diagnostics fixture (one that fails on any page error) fails on a ShowMore that commits inside the callback.
for (const id of ["lists-showmore--playground", "lists-showmore--in-context", "lists-showmore--long-post"]) {
  test(`show more raises no ResizeObserver notice while it measures (${id})`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await openStory(page, id);
    await page.getByRole("button", { name: "Show more" }).first().waitFor();
    // Measure again, as a resized window does.
    await page.setViewportSize({ width: 360, height: 700 });
    await page.setViewportSize({ width: 900, height: 700 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(errors).toEqual([]);
  });
}
