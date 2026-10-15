import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("is a labeled native select with groups and a required placeholder", async ({ page }) => {
  await openStory(page, "forms-nativeselect--states");
  const country = page.getByRole("combobox", { name: "Country" });
  await expect(country).toHaveAttribute("aria-required", "true");
  await expect(country).toHaveAccessibleDescription("Where we ship the box.");
  await country.selectOption("nz");
  await expect(country).toHaveValue("nz");
  await expect(page.getByRole("combobox", { name: "Oven" })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("combobox", { name: "Language" })).toBeDisabled();
});
