import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("choice cards are a radio group: a click or the arrow keys choose a card", async ({ page }) => {
  await openStory(page, "forms-choicecard--playground");
  const group = page.getByRole("group", { name: "Cover" });
  await expect(group.getByRole("radio", { name: "Noon" })).toBeChecked();
  await group.getByText("Dusk").click();
  await expect(group.getByRole("radio", { name: "Dusk" })).toBeChecked();
  // Safari does not focus a radio that is clicked through its label, so focus it as a keyboard would.
  await group.getByRole("radio", { name: "Dusk" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(group.getByRole("radio", { name: "Noon" })).toBeChecked();
});
