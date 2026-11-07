import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("chosen files are listed and can be removed", async ({ page }) => {
  await openStory(page, "forms-filefield--playground");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({
    name: "pasta.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"),
  });
  await expect(page.getByText("pasta.png", { exact: true })).toBeVisible();
  await expect(page.locator("[data-ouro-file-list] img")).toHaveAttribute("src", /^blob:/);
  await page.getByRole("button", { name: "Remove pasta.png" }).click();
  await expect(page.getByText("pasta.png", { exact: true })).toHaveCount(0);
  await expect(input).toBeFocused();
});
