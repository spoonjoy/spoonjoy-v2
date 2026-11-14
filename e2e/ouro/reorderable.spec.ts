import { expect, test } from "../ouro-fixtures";
import { openStory, settledBox, tapKeepsCancelledClick } from "./story";

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
  await settledBox(page.getByRole("menu"));
  await page.getByRole("menuitem", { name: "Move to bottom" }).click();
  await expect(page.locator("[data-ouro-announcer]")).toHaveText("Sear the ribs moved. Position 4 of 4.");
  await expect(handles.nth(3)).toHaveAttribute("aria-label", "Reorder Sear the ribs");
  await expect(page.getByTestId("saved-order")).toHaveText("Saved order: soften, wine, braise, sear");
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("a disabled list keeps its handles focusable and unavailable, and moves nothing", async ({ page }) => {
  await openStory(page, "lists-reorderable--disabled");
  const first = page.locator("[data-ouro-reorderable-handle]").first();
  const name = await first.getAttribute("aria-label");
  await expect(first).toHaveAttribute("aria-disabled", "true");
  await first.focus();
  await expect(first).toBeFocused();
  await page.keyboard.press("Space");
  await expect(first).not.toHaveAttribute("data-grabbed");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await first.click({ force: true });
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.locator("[data-ouro-reorderable-handle]").first()).toHaveAttribute("aria-label", name!);
});

test.describe("by touch", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("a tap on the handle opens the menu of moves, and a tap on a move makes it", async ({ page }) => {
    await openStory(page, "lists-reorderable--in-context");
    // The handle cancels pointerdown, so a press selects no text and starts no native drag. The WebKit that
    // Playwright drives before 1.65 then raises no click from a tap (tapKeepsCancelledClick), so there is no tap to test.
    test.skip(!(await tapKeepsCancelledClick(page)), "this browser drops a tap's click after a cancelled pointerdown (microsoft/playwright#43569)");
    await page.getByRole("button", { name: "Reorder Sear the ribs" }).tap();
    await expect(page.getByRole("menu")).toBeVisible();
    // Below 640px the menu is a bottom sheet that slides up. A tap on a move still moving can come up on the next item and drop the click, so wait until it has stopped.
    await settledBox(page.getByRole("menu"));
    await page.getByRole("menuitem", { name: "Move to bottom" }).tap();
    await expect(page.getByTestId("saved-order")).toHaveText("Saved order: soften, wine, braise, sear");
  });
});
