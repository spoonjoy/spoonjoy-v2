import { expect, test } from "../ouro-fixtures";
import { holdClock, openStory } from "./story";

test("a press shows the busy state, keeps focus, then settles", async ({ page }) => {
  await page.clock.install();
  await openStory(page, "actions-button--loading");
  const save = page.getByRole("button", { name: "Save to cookbook" }).first();
  await save.focus();
  // The story's save takes 1.6s of the page's clock, which stands still from here.
  await holdClock(page);
  await save.press("Enter");
  await expect(save).toHaveAttribute("aria-busy", "true");
  await expect(save).toHaveAttribute("aria-disabled", "true");
  await expect(save).toBeFocused();
  await page.clock.runFor(1600);
  await expect(save).not.toHaveAttribute("aria-busy", "true");
});

test("href makes it a link that navigates", async ({ page }) => {
  await openStory(page, "actions-button--links");
  await page.getByRole("link", { name: "Browse recipes" }).click();
  await expect(page).toHaveURL(/#recipes$/);
});
