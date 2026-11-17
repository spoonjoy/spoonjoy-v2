import { expect, type Page } from "@playwright/test";

/**
 * The recipe page's scale lives in the "Serves" capsule's popover (the one-book meta row). Opens
 * it when it is closed, so the Scale field and its Increase and Decrease buttons can be used.
 */
export async function openScale(page: Page) {
  const field = page.getByRole("textbox", { name: "Scale", exact: true });
  if (!(await field.isVisible())) await page.getByTestId("recipe-serves-trigger").click();
  await expect(field).toBeVisible();
}
