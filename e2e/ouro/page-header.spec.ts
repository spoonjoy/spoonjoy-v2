import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("a page header is the page's h1 with its actions beside it on a wide screen and under it on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openStory(page, "layout-pageheader--in-context");
  const title = page.getByRole("heading", { level: 1, name: "Harbor survey" });
  await expect(title).toBeVisible();
  const edit = page.getByRole("button", { name: "Edit" });
  expect((await edit.boundingBox())!.x).toBeGreaterThan((await title.boundingBox())!.x + (await title.boundingBox())!.width - 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await edit.boundingBox())!.y).toBeGreaterThan((await title.boundingBox())!.y);
});
