import { expect, test } from "../ouro-fixtures";
import { openStory, pressTab } from "./story";

test("a card with href navigates from anywhere on it, named by its title", async ({ page }) => {
  await openStory(page, "display-card--in-context");
  await expect(page.getByRole("link", { name: "Weeknight dinners" })).toBeVisible();
  // A real click where the description is: the link's hit area covers it, so Playwright's
  // locator.click would wait for the description itself to receive the click.
  const box = (await page.getByText("12 recipes").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page).toHaveURL(/#weeknight-dinners$/);
});

test("a linked card is one tab stop, and its action is its own", async ({ page }) => {
  await openStory(page, "display-card--in-context");
  await page.getByRole("link", { name: "Weeknight dinners" }).focus();
  await pressTab(page);
  await expect(page.getByRole("button", { name: "Share Weeknight dinners" })).toBeFocused();
  await pressTab(page);
  await expect(page.getByRole("link", { name: "Sunday bakes" })).toBeFocused();
});

test("the action does not follow the card's link", async ({ page }) => {
  await openStory(page, "display-card--in-context");
  const url = page.url();
  await page.getByRole("button", { name: "Share Sunday bakes" }).click();
  expect(page.url()).toBe(url);
});
