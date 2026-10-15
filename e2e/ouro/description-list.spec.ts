import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("terms sit above their details on a phone and beside them on a wide screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStory(page, "display-descriptionlist--in-context");
  let term = (await page.getByText("Prep time").boundingBox())!;
  let details = (await page.getByText("20 minutes").boundingBox())!;
  expect(details.y).toBeGreaterThanOrEqual(term.y + term.height - 1);
  await page.setViewportSize({ width: 1280, height: 800 });
  term = (await page.getByText("Prep time").boundingBox())!;
  details = (await page.getByText("20 minutes").boundingBox())!;
  // The term fills its column, so the details start where it ends.
  expect(details.x).toBeGreaterThanOrEqual(term.x + term.width);
  expect(Math.abs(details.y - term.y)).toBeLessThanOrEqual(1);
});
