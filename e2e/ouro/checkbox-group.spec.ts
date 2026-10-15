import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("the group is named by its legend and each box toggles on its own", async ({ page }) => {
  await openStory(page, "forms-checkboxgroup--herbs");
  const group = page.getByRole("group", { name: "Herbs" });
  await expect(group).toHaveAccessibleDescription("Pick any you have fresh.");
  await expect(group.getByRole("checkbox", { name: "Basil" })).toBeChecked();
  await expect(group.getByRole("checkbox", { name: "Mint" })).not.toBeChecked();
  await group.getByText("Mint").click();
  await expect(group.getByRole("checkbox", { name: "Mint" })).toBeChecked();
  await group.getByRole("checkbox", { name: "Basil" }).press("Space");
  await expect(group.getByRole("checkbox", { name: "Basil" })).not.toBeChecked();
  await expect(group.getByRole("checkbox", { name: "Dill" })).toBeDisabled();
});
