import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("the cropper moves the photo with the keyboard and saves the crop", async ({ page }) => {
  await openStory(page, "forms-imagecropper--in-context");
  await page.getByRole("button", { name: "Crop photo" }).click();
  const dialog = page.getByRole("dialog", { name: "Crop photo" });
  const area = dialog.getByRole("application", { name: "Photo to crop" });
  await expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();
  await area.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("+");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  const cropped = page.getByRole("img", { name: "The cropped photo" });
  await expect(cropped).toBeVisible();
  expect(await cropped.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(256);
});
