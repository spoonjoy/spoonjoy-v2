// Spoonjoy: the local fixture fails a spec on any browser warning or error (e2e/fixtures.ts).
import { expect, test } from "../fixtures";
import { openStory } from "./story";

test("a link navigates", async ({ page }) => {
  await openStory(page, "text-link--in-context");
  await page.getByRole("link", { name: "our braising guide" }).click();
  await expect(page).toHaveURL(/#braising$/);
});

test("an external link opens a new tab and says so", async ({ page }) => {
  await openStory(page, "text-link--in-context");
  const link = page.getByRole("link", { name: "the original recipe (opens in a new tab)" });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
});
