import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("a separator divides content and a decorative one is hidden", async ({ page }) => {
  await openStory(page, "display-separator--in-context");
  const separators = page.getByRole("separator");
  await expect(separators).toHaveCount(1);
  await expect(separators).toHaveAttribute("aria-orientation", "horizontal");
  const box = await separators.boundingBox();
  expect(box!.height).toBe(1);
});

test("a labelled separator reads its label between two lines", async ({ page }) => {
  await openStory(page, "display-separator--labelled");
  const label = page.locator('[data-ouro="separator"] [data-slot="separator-label"]');
  await expect(label).toHaveText("or");
  const lines = page.locator('[data-ouro="separator"] [data-slot="separator-line"]');
  await expect(lines).toHaveCount(2);
  await expect(page.getByRole("separator")).toHaveCount(0);
});
