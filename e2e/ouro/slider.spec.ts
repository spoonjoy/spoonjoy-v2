import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("arrow keys move the thumb and the shown value follows", async ({ page }) => {
  await openStory(page, "forms-slider--states");
  const spice = page.getByRole("slider", { name: "Spice level" });
  await expect(spice).toHaveAttribute("aria-valuenow", "2");
  await spice.focus();
  await spice.press("ArrowRight");
  await expect(spice).toHaveAttribute("aria-valuenow", "3");
  await expect(spice).toHaveAccessibleDescription("0 is mild, 5 is very hot.");
});

test("a range names each thumb after the label", async ({ page }) => {
  await openStory(page, "forms-slider--range");
  const low = page.getByRole("slider", { name: "Minimum, Price" });
  const high = page.getByRole("slider", { name: "Maximum, Price" });
  await expect(low).toHaveAttribute("aria-valuenow", "10");
  await low.focus();
  await low.press("ArrowRight");
  await expect(low).toHaveAttribute("aria-valuenow", "11");
  await expect(high).toHaveAttribute("aria-valuenow", "40");
});
