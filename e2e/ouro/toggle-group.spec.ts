import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("one toggle at a time, with arrow-key focus", async ({ page }) => {
  await openStory(page, "actions-togglegroup--modes");
  const group = page.getByRole("group", { name: "Alignment" });
  const left = group.getByRole("button", { name: "Left" });
  const center = group.getByRole("button", { name: "Center" });
  await expect(center).toHaveAttribute("aria-pressed", "true");
  await left.click();
  await expect(left).toHaveAttribute("aria-pressed", "true");
  await expect(center).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("ArrowRight");
  await expect(center).toBeFocused();
});

test("several toggles at once with multiple", async ({ page }) => {
  await openStory(page, "actions-togglegroup--modes");
  const group = page.getByRole("group", { name: "Text style" });
  await expect(group.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
  await group.getByRole("button", { name: "Italic" }).click();
  await expect(group.getByRole("button", { name: "Italic" })).toHaveAttribute("aria-pressed", "true");
  await expect(group.getByRole("button", { name: "Underline" })).toHaveAttribute("aria-pressed", "true");
});
