import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("each frame keeps its ratio at the width the layout gives it", async ({ page }) => {
  await openStory(page, "layout-aspectratio--ratios");
  for (const [label, ratio] of [
    ["16:9", 16 / 9],
    ["4:3", 4 / 3],
    ["1:1", 1],
  ] as const) {
    const box = await page.getByRole("img", { name: `Short ribs at ${label}` }).boundingBox();
    expect(box!.width / box!.height).toBeCloseTo(ratio, 1);
  }
});
