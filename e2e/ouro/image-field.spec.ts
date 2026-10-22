import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("the image field previews a chosen photo and turns away other files", async ({ page }) => {
  await openStory(page, "forms-imagefield--playground");
  const field = page.getByRole("group", { name: "Photo" });
  const chooser = page.waitForEvent("filechooser");
  await field.getByRole("button", { name: "Choose photo" }).click();
  await (await chooser).setFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("notes") });
  await expect(field.getByText("notes.txt is not an image this field takes.")).toBeVisible();
  const again = page.waitForEvent("filechooser");
  await field.getByRole("button", { name: "Choose photo" }).click();
  await (await again).setFiles({ name: "dot.png", mimeType: "image/png", buffer: png });
  await expect(field.getByRole("button", { name: "Change photo" })).toBeVisible();
  await expect(field.locator("img")).toHaveAttribute("src", /^blob:/);
  await field.getByRole("button", { name: "Remove" }).click();
  await expect(field.getByRole("button", { name: "Choose photo" })).toBeVisible();
});
