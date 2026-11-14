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

test("wheel scrolling a long scroller of loading skeletons with shimmer={false} runs no animation on them", async ({ page }) => {
  await openStory(page, "feedback-skeleton--long-scroller-still");
  const scroller = page.getByRole("region", { name: "Long scroller" });
  const box = (await scroller.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 600);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const running = await page.evaluate(() =>
    document.getAnimations().filter((animation) => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      return animation.playState === "running" && target instanceof Element && target.closest('[data-ouro="skeleton"]') !== null;
    }).length,
  );
  expect(running, "an animation runs on a skeleton with shimmer={false}").toBe(0);
});
