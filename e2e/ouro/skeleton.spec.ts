import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("skeletons are hidden from screen readers inside a busy region", async ({ page }) => {
  await openStory(page, "feedback-skeleton--recipe-card");
  const card = page.getByRole("group", { name: "Loading recipe" });
  // real clock: the story's card is busy for good; nothing in it ends on a timer.
  await expect(card).toHaveAttribute("aria-busy", "true");
  const skeletons = card.locator('[data-ouro="skeleton"]');
  await expect(skeletons).toHaveCount(6);
  for (const skeleton of await skeletons.all()) await expect(skeleton).toHaveAttribute("aria-hidden", "true");
});
