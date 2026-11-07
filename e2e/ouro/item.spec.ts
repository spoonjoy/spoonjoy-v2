import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("a row with href navigates from its media, and its action does not", async ({ page }) => {
  await openStory(page, "lists-item--in-context");
  const url = page.url();
  await page.getByRole("button", { name: "Save" }).click();
  expect(page.url()).toBe(url);
  // A real click on the photo: the link's hit area covers it.
  const box = (await page.locator('[data-ouro="item"] img').first().boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page).toHaveURL(/#short-ribs$/);
});

test("a row's actions drop under its text on a phone with stackBelow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStory(page, "lists-item--in-context");
  const title = await page.getByText("Sync token").boundingBox();
  const revoke = await page.getByRole("button", { name: "Revoke" }).boundingBox();
  expect(revoke!.y).toBeGreaterThan(title!.y + title!.height);
});

test("a row's link is described by its description, as a screen reader hears it", async ({ page }) => {
  await openStory(page, "lists-item--in-context");
  const link = page.getByRole("link", { name: "Braised short ribs" });
  await expect(link).toHaveAccessibleName("Braised short ribs");
  await expect(link).toHaveAccessibleDescription(/^Seared hard, then braised low in red wine and stock/);
});
