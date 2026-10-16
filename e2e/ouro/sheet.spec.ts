import { expect, test } from "../ouro-fixtures";
import { openStory, settledBox, slowDrag } from "./story";

test.use({ viewport: { width: 390, height: 844 } });

test("open the sheet, drag it part way and it springs back, then drag it away", async ({ page }) => {
  await openStory(page, "overlays-sheet--playground");
  await page.getByRole("button", { name: "Save" }).click();
  const sheet = page.getByRole("dialog", { name: "Save to cookbook" });
  await expect(sheet).toBeVisible();
  await expect(page.getByRole("button", { name: "Baking (saved)" })).toBeVisible();

  const box = await settledBox(sheet);
  const x = box.x + box.width / 2;
  const y = box.y + 12;

  // A short, slow drag springs back.
  await slowDrag(page, x, y, y + box.height * 0.1, 600);
  await expect(sheet).toBeVisible();
  expect((await settledBox(sheet)).y).toBeCloseTo(box.y, 0);

  // A long drag down dismisses it.
  await slowDrag(page, x, y, y + box.height * 0.8, 600);
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: "Save" })).toBeFocused();
});

test("Escape closes the sheet and returns focus to the trigger", async ({ page }) => {
  await openStory(page, "overlays-sheet--playground");
  const trigger = page.getByRole("button", { name: "Save" });
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "Save to cookbook" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(trigger).toBeFocused();
});
