import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("opens beside its trigger, reaches its field, and closes with Escape back to the trigger", async ({ page }) => {
    await openStory(page, "overlays-popover--playground");
    const trigger = page.getByRole("button", { name: "Share" });
    await trigger.click();
    const popover = page.getByRole("dialog", { name: "Share recipe" });
    await expect(popover).toBeVisible();
    await expect(popover.getByRole("textbox", { name: "Link" })).toHaveValue("https://spoonjoy.app/r/shakshuka");
    const box = (await popover.boundingBox())!;
    const anchor = (await trigger.boundingBox())!;
    expect(box.y).toBeGreaterThan(anchor.y + anchor.height);
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("closes from a click outside", async ({ page }) => {
    await openStory(page, "overlays-popover--playground");
    await page.getByRole("button", { name: "Share" }).click();
    const popover = page.getByRole("dialog", { name: "Share recipe" });
    await expect(popover).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(popover).toBeHidden();
  });

  test("a controlled popover toggles from its anchor button", async ({ page }) => {
    await openStory(page, "overlays-popover--controlled");
    const anchor = page.getByRole("button", { name: "Servings" });
    await anchor.click();
    await expect(page.getByRole("dialog", { name: "Servings" })).toBeVisible();
    await anchor.click();
    await expect(page.getByRole("dialog", { name: "Servings" })).toBeHidden();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("presentation auto opens a bottom sheet", async ({ page }) => {
    await openStory(page, "overlays-popover--auto-presentation");
    await page.getByRole("button", { name: "Filters" }).click();
    const sheet = page.getByRole("dialog", { name: "Filters" });
    await expect(sheet).toBeVisible();
    await expect.poll(async () => Math.round((await sheet.boundingBox())!.y + (await sheet.boundingBox())!.height)).toBe(844);
  });
});
