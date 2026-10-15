import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("an autoGrow textarea grows as you type, then stops and scrolls", async ({ page }) => {
  await openStory(page, "forms-textarea--auto-grow");
  const message = page.getByRole("textbox", { name: "Message" });
  const start = (await message.boundingBox())!.height;
  await message.fill("one\ntwo\nthree\nfour");
  await expect.poll(async () => (await message.boundingBox())!.height).toBeGreaterThan(start);
  const four = (await message.boundingBox())!.height;
  await message.fill("1\n2\n3\n4\n5\n6\n7\n8\n9\n10");
  await expect.poll(async () => (await message.boundingBox())!.height).toBeGreaterThan(four);
  const capped = (await message.boundingBox())!.height;
  await message.fill("1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14");
  await expect(message).toHaveCSS("overflow-y", "auto");
  expect((await message.boundingBox())!.height).toBe(capped);
});

test("a textarea is labeled, described and marked invalid", async ({ page }) => {
  await openStory(page, "forms-textarea--states");
  const review = page.getByRole("textbox", { name: "Review" });
  await expect(review).toHaveAttribute("aria-invalid", "true");
  await expect(review).toHaveAccessibleDescription("Keep it under 500 characters.");
  await expect(page.getByRole("textbox", { name: "Notes", exact: true })).toHaveAttribute("aria-required", "true");
  await expect(page.getByRole("textbox", { name: "Shared notes" })).toBeDisabled();
});
