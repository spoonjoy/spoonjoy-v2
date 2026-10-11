import { expect, test } from "@playwright/test";
import { openStory } from "./story";

test("a press shows the busy state, keeps focus, then settles", async ({ page }) => {
  await openStory(page, "actions-button--loading");
  const save = page.getByRole("button", { name: "Save to cookbook" }).first();
  await save.focus();
  await save.press("Enter");
  await expect(save).toHaveAttribute("aria-busy", "true");
  await expect(save).toHaveAttribute("aria-disabled", "true");
  await expect(save).toBeFocused();
  await expect(save).not.toHaveAttribute("aria-busy", "true", { timeout: 5000 });
});

test("href makes it a link that navigates", async ({ page }) => {
  await openStory(page, "actions-button--links");
  await page.getByRole("link", { name: "Browse recipes" }).click();
  await expect(page).toHaveURL(/#recipes$/);
});
