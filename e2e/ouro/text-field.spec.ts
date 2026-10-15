import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("the password toggle shows the password and keeps typing in place", async ({ page }) => {
  await openStory(page, "forms-textfield--types");
  // A loose label lookup: the show/hide button is named "Show password", but not labelled.
  const password = page.getByLabel("Password");
  await expect(password).toHaveAttribute("type", "password");
  await password.click();
  await password.press("End");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toBeFocused();
  await expect(page.getByRole("button", { name: "Show password" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.type("!");
  await expect(password).toHaveValue("pasta-night!");
});

test("each type sets the keyboard and autofill", async ({ page }) => {
  await openStory(page, "forms-textfield--types");
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveAttribute("inputmode", "email");
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveAttribute("autocomplete", "email");
  await expect(page.getByRole("textbox", { name: "Phone" })).toHaveAttribute("inputmode", "tel");
  await expect(page.getByRole("searchbox", { name: "Search recipes" })).toHaveAttribute("inputmode", "search");
});

test("clear empties the field and puts focus back in it", async ({ page }) => {
  await openStory(page, "forms-textfield--adornments");
  const search = page.getByRole("searchbox", { name: "Search recipes" });
  await expect(search).toHaveValue("Pasta");
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(page.getByRole("button", { name: "Clear" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Price" })).toHaveAccessibleDescription("$ per jar");
});

test("a field draws a 1px border in the theme's --input color, with rounded corners", async ({ page }) => {
  await openStory(page, "forms-textfield--types");
  const field = page.locator("[data-ouro-input-group]").first();
  const style = await field.evaluate((element) => {
    const computed = getComputedStyle(element);
    // The theme's --input as the browser resolves it, whatever notation the theme uses.
    const probe = document.createElement("div");
    probe.style.border = "1px solid var(--input)";
    document.body.append(probe);
    const input = getComputedStyle(probe).borderTopColor;
    probe.remove();
    return {
      token: getComputedStyle(document.documentElement).getPropertyValue("--input").trim(),
      width: computed.borderTopWidth,
      line: computed.borderTopStyle,
      color: computed.borderTopColor,
      radius: Number.parseFloat(computed.borderTopLeftRadius),
      input,
    };
  });
  // ouro-base gives a theme that has neither its --input and its --radius scale.
  expect(style.token).not.toBe("");
  expect(style.width).toBe("1px");
  expect(style.line).toBe("solid");
  expect(style.color).toBe(style.input);
  expect(style.radius).toBeGreaterThan(0);
});
