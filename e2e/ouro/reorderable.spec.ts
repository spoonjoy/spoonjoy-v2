import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("reorders with the keyboard: Space picks a row up, the arrows move it, Space drops it, Escape puts it back", async ({ page }) => {
  await openStory(page, "lists-reorderable--in-context");
  const handles = page.locator("[data-ouro-reorderable-handle]");
  const saved = page.getByTestId("saved-order");
  await expect(saved).toHaveText("Saved order: sear, soften, wine, braise");
  const sear = page.getByRole("button", { name: "Reorder Sear the ribs" });
  await sear.focus();
  await page.keyboard.press("Space");
  await expect(sear).toHaveAttribute("data-grabbed", "");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(sear).toBeFocused();
  await expect(page.locator("[data-ouro-announcer]")).toHaveText("Sear the ribs moved. Position 3 of 4.");
  await page.keyboard.press("Space");
  await expect(sear).not.toHaveAttribute("data-grabbed");
  await expect(saved).toHaveText("Saved order: soften, wine, sear, braise");
  await expect(handles.nth(2)).toHaveAttribute("aria-label", "Reorder Sear the ribs");

  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Escape");
  await expect(handles.nth(2)).toHaveAttribute("aria-label", "Reorder Sear the ribs");
  await expect(saved).toHaveText("Saved order: soften, wine, sear, braise");
});

test("reorders with a drag on the handle", async ({ page }) => {
  await openStory(page, "lists-reorderable--in-context");
  const handles = page.locator("[data-ouro-reorderable-handle]");
  const from = (await page.getByRole("button", { name: "Reorder Braise" }).boundingBox())!;
  const to = (await handles.first().boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 - 4, { steps: 8 });
  await page.mouse.up();
  await expect(handles.first()).toHaveAttribute("aria-label", "Reorder Braise");
  await expect(page.getByTestId("saved-order")).toHaveText("Saved order: braise, sear, soften, wine");
});

test("reorders without a drag: a click on the handle opens a menu of moves", async ({ page }) => {
  await openStory(page, "lists-reorderable--in-context");
  const handles = page.locator("[data-ouro-reorderable-handle]");
  await page.getByRole("button", { name: "Reorder Sear the ribs" }).click();
  await expect(page.getByRole("menuitem", { name: "Move up" })).toHaveAttribute("data-disabled");
  await page.getByRole("menuitem", { name: "Move to bottom" }).click();
  await expect(page.locator("[data-ouro-announcer]")).toHaveText("Sear the ribs moved. Position 4 of 4.");
  await expect(handles.nth(3)).toHaveAttribute("aria-label", "Reorder Sear the ribs");
  await expect(page.getByTestId("saved-order")).toHaveText("Saved order: soften, wine, braise, sear");
  await expect(page.getByRole("menu")).toHaveCount(0);
});
