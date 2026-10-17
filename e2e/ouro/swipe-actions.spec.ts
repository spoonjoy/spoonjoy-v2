import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("a row's actions button gives the keyboard every swipe action, and Undo brings a deleted row back", async ({ page }) => {
  await openStory(page, "lists-swipeactions--in-context");
  const rows = page.locator('[data-ouro="swipe-actions"]');
  await expect(rows).toHaveCount(3);
  const actions = page.getByRole("button", { name: "Actions for Shakshuka" });
  await actions.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem")).toHaveText(["Pin", "Delete", "Share"]);
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByText("Shakshuka deleted")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(rows).toHaveCount(3);
  await expect(page.getByRole("link", { name: "Shakshuka" })).toBeVisible();
});

test("a mouse follows a swipeable row's link and never drags the row", async ({ page }) => {
  await openStory(page, "lists-swipeactions--in-context");
  const row = page.locator('[data-ouro="swipe-actions"]').nth(1);
  const box = (await row.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 200, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, y, { steps: 6 });
  await page.mouse.up();
  await expect(row).not.toHaveAttribute("data-open");
  await page.mouse.click(box.x + 60, y);
  await expect(page).toHaveURL(/#short-ribs$/);
});

test("a mouse's right-click on a row is left to the browser's own menu", async ({ page }) => {
  await openStory(page, "lists-swipeactions--in-context");
  const link = page.getByRole("link", { name: "Shakshuka" });
  // Heard on its way down, because the row stops it there, and read once every handler has had its say.
  await page.evaluate(() => {
    const seen = window as unknown as { rightClick?: boolean };
    window.addEventListener("contextmenu", (event) => setTimeout(() => (seen.rightClick = event.defaultPrevented)), { once: true, capture: true });
  });
  await link.click({ button: "right" });
  await expect.poll(() => page.evaluate(() => (window as unknown as { rightClick?: boolean }).rightClick)).toBe(false);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page).not.toHaveURL(/#shakshuka$/);
});
