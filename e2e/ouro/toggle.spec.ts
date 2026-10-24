import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("a toggle keeps its name and flips aria-pressed", async ({ page }) => {
  await openStory(page, "actions-toggle--states");
  const bold = page.getByRole("button", { name: "Bold", exact: true });
  await expect(bold).toHaveAttribute("aria-pressed", "false");
  await bold.click();
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await bold.press("Space");
  await expect(bold).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Archived" })).toBeDisabled();
});
