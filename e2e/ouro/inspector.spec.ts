import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("X-ray tags each component with a link to its docs, and lists them for the keyboard", async ({ page }) => {
  await openStory(page, "app-setup-inspector--in-context");
  const tags = page.locator('[data-ouro-control="inspector"][data-ouro-part="tag"]');
  await expect(tags.first()).toBeVisible();
  await expect(tags.filter({ hasText: "checklist" })).toHaveAttribute("href", "https://ui.ouro.bot/docs/checklist/");
  // A click through an outline still reaches the page.
  await page.getByText("1 cup").nth(1).click();
  await expect(page.getByRole("checkbox", { name: "milk" })).toBeChecked();
  const list = page.getByRole("button", { name: /components$/ });
  await list.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "X-ray" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Docs for checklist (opens in a new tab)" })).toHaveAttribute("href", "https://ui.ouro.bot/docs/checklist/");
  await expect(sheet.getByRole("link", { name: "Source of checklist (opens in a new tab)" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(tags).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "X-ray" })).not.toBeChecked();
});
