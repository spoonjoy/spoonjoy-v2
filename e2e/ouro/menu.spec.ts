import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("opens below its trigger, runs an item from the keyboard, and returns focus to the trigger", async ({ page }) => {
    await openStory(page, "menus-menu--playground");
    const trigger = page.getByRole("button", { name: "Actions" });
    await trigger.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    const anchor = (await trigger.boundingBox())!;
    expect(box.y).toBeGreaterThan(anchor.y + anchor.height);
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: /^Edit/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("opens a submenu with the right arrow and closes it with the left arrow", async ({ page }) => {
    await openStory(page, "menus-menu--playground");
    await page.getByRole("button", { name: "Actions" }).click();
    const share = page.getByRole("menuitem", { name: "Share" });
    await share.focus();
    await page.keyboard.press("ArrowRight");
    // The submenu moves focus to its first item; ArrowLeft before that reaches the parent menu.
    await expect(page.getByRole("menuitem", { name: "Copy link" })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("menuitem", { name: "Copy link" })).toBeHidden();
    await expect(share).toBeFocused();
  });

  test("a right-click opens the context menu at the pointer", async ({ page }) => {
    await openStory(page, "menus-menu--context-menu");
    const area = page.getByText("Right-click or long-press here");
    const box = (await area.boundingBox())!;
    await page.mouse.click(box.x + 40, box.y + 30, { button: "right" });
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const popup = (await menu.boundingBox())!;
    expect(Math.abs(popup.x - (box.x + 40))).toBeLessThanOrEqual(16);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  test("the menubar moves between menus with the arrow keys, and on hover once one is open", async ({ page }) => {
    await openStory(page, "menus-menu--bar");
    const file = page.getByRole("menuitem", { name: "File", exact: true });
    const edit = page.getByRole("menuitem", { name: "Edit", exact: true });
    await file.focus();
    await page.keyboard.press("ArrowRight");
    await expect(edit).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: /^Undo/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await file.click();
    await expect(page.getByRole("menuitem", { name: /^New recipe/ })).toBeVisible();
    await edit.hover();
    await expect(page.getByRole("menuitem", { name: /^Undo/ })).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a dropdown opens as a bottom sheet", async ({ page }) => {
    await openStory(page, "menus-menu--playground");
    await page.getByRole("button", { name: "Actions" }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect.poll(async () => Math.round((await menu.boundingBox())!.y + (await menu.boundingBox())!.height)).toBe(844);
  });
});
