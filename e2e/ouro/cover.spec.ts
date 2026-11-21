import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("a list row's cover is its recipe's initial on a tinted tile, beside the title, and read as nothing", async ({ page }) => {
  await openStory(page, "display-cover--in-context");
  const covers = page.locator('[data-ouro="cover"]');
  await expect(covers).toHaveCount(3);
  await expect(covers.first()).toHaveText("L");
  await expect(page.getByRole("img")).toHaveCount(0);
  const title = page.getByText("Lemon rice", { exact: true });
  expect((await title.boundingBox())!.x).toBeGreaterThan((await covers.first().boundingBox())!.x + 55);
});
