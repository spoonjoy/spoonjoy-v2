import { expect, test } from "../ouro-fixtures";
import { openStory, settledBox } from "./story";

test("chooses an option with the mouse and the keyboard", async ({ page }) => {
  await openStory(page, "forms-select--playground");
  const course = page.getByRole("combobox", { name: "Course" });
  await expect(course).toHaveText("Choose a course");
  await course.click();
  await page.getByRole("option", { name: "Main" }).click();
  await expect(course).toHaveText("Main");
  await expect(course).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(page.getByRole("option", { name: "Main", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "Side", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(course).toHaveText("Side");
});

test("keeps the list open while choosing several values", async ({ page }) => {
  await openStory(page, "forms-select--multiple");
  const tags = page.getByRole("combobox", { name: "Tags" });
  await expect(tags).toHaveText("Quick, Vegetarian");
  await tags.click();
  await page.getByRole("option", { name: "Spicy" }).click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(tags).toHaveText("Quick, Vegetarian, Spicy");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  // Chromium reports a coarse pointer for a touch phone; desktop WebKit does not emulate one.
  test.skip(({ browserName }) => browserName !== "chromium", "coarse pointer emulation is Chromium's");

  test("opens the list as a bottom sheet and chooses with a tap", async ({ page }) => {
    await openStory(page, "forms-select--long-list");
    await page.getByRole("combobox", { name: "Ingredient" }).tap();
    const sheet = page.locator('[data-ouro="select-popup"][data-ouro-presentation="sheet"]');
    const box = await settledBox(sheet);
    expect(Math.round(box.y + box.height)).toBe(844);
    expect(box.width).toBe(390);
    await page.getByRole("option", { name: "Basil" }).tap();
    await expect(page.getByRole("combobox", { name: "Ingredient" })).toHaveText("Basil");
  });
});
