import { expect, type Page } from "@playwright/test";

/**
 * The recipe page's scale lives in the "Serves" capsule's popover (the one-book meta row). These
 * open it, do one thing and close it again with Escape, so the page underneath is as a cook leaves
 * it: clickable, scrollable and audited without the popover over it.
 */
async function withScale(page: Page, act: () => Promise<void>) {
  const field = page.getByRole("textbox", { name: "Scale", exact: true });
  if (!(await field.isVisible())) await page.getByTestId("recipe-serves-trigger").click();
  await expect(field).toBeVisible();
  await act();
  await page.keyboard.press("Escape");
  await expect(field).toBeHidden();
}

/** Says the scale reads `value` ("1.25"). */
export async function expectScale(page: Page, value: string) {
  await withScale(page, () => expect(page.getByRole("textbox", { name: "Scale", exact: true })).toHaveValue(value));
}

/** Presses Increase scale once, and waits for the scale to read `value`. */
export async function stepScaleUp(page: Page, value: string) {
  await withScale(page, async () => {
    await page.getByRole("button", { name: "Increase scale" }).click();
    await expect(page.getByRole("textbox", { name: "Scale", exact: true })).toHaveValue(value);
  });
}
