import type { Locator, Page } from "@playwright/test";
import { settledBox } from "../../ouro/story";

/**
 * Opens a menu from its trigger and chooses one of its items once the menu has stopped moving. On a phone the
 * menu is a sheet that rises from below the screen, and it mounts a frame before its slide starts, so Playwright
 * can find an item stable at the bottom edge and click there just before the sheet moves: the click misses the
 * item (spoonjoy-v2#835, spoonjoy-v2#846).
 *
 * @example
 * await chooseMenuItem(page, page.getByRole("button", { name: "List actions", exact: true }), "Clear all");
 */
export async function chooseMenuItem(page: Page, trigger: Locator, name: string) {
  await trigger.click();
  await settledBox(page.getByRole("menu"));
  await page.getByRole("menuitem", { name, exact: true }).click();
}
