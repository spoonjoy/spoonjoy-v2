import { expect, test } from "../ouro-fixtures";
import { openStory } from "./story";

test("draws a message's tokens and emoji text as the catalogue's images, named for screen readers", async ({ page }) => {
  await openStory(page, "chat-emoji--in-messages");
  const party = page.getByRole("img", { name: "Party popper" }).first();
  await expect(party).toBeVisible();
  await expect(party).toHaveJSProperty("complete", true);
  await expect(page.getByRole("img", { name: "Waving hand" })).toBeVisible();
  await expect(page.getByText(":unknown: stays text")).toBeVisible();
  await expect(page.getByText(":party:")).toHaveCount(0);
});

test("plays an animated emoji while its button is under the mouse, and shows it still again after", async ({ page }) => {
  await openStory(page, "chat-emoji--in-buttons");
  const button = page.getByRole("button", { name: "Party popper" });
  const image = button.locator("img");
  const still = await image.getAttribute("src");
  await button.hover();
  await expect(image).not.toHaveAttribute("src", still!);
  await page.mouse.move(0, 0);
  await expect(image).toHaveAttribute("src", still!);
});

test("keeps an animated emoji still with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openStory(page, "chat-emoji--in-buttons");
  const button = page.getByRole("button", { name: "Party popper" });
  const image = button.locator("img");
  const still = await image.getAttribute("src");
  await button.hover();
  await button.focus();
  await expect(image).toHaveAttribute("src", still!);
});

test("steps a filmstrip emoji through its frames while its button is under the mouse", async ({ page }) => {
  await openStory(page, "chat-emoji--in-buttons");
  const button = page.getByRole("button", { name: "Blinking face" });
  const image = button.locator("img");
  const still = await image.getAttribute("src");
  await button.hover();
  await expect(image).not.toHaveAttribute("src", still!);
  await expect.poll(() => image.evaluate((element) => element.getAnimations().length)).toBe(1);
  await page.mouse.move(0, 0);
  await expect(image).toHaveAttribute("src", still!);
  await expect.poll(() => image.evaluate((element) => element.getAnimations().length)).toBe(0);
});

test("shows each picture over its placeholder once it has loaded, keeps the placeholder for one that cannot load, and shows it again for a fresh load", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openStory(page, "chat-emoji--placeholder");
  const emoji = page.locator('[data-ouro="emoji"]');
  await expect(emoji).toHaveCount(5);
  const party = page.getByRole("img", { name: "Party popper" });
  await expect(party).toHaveCSS("opacity", "1");
  await expect(page.getByRole("img", { name: "Waving hand" })).toHaveCSS("opacity", "1");
  await expect(emoji.filter({ has: party })).toHaveAttribute("data-loaded", "");
  // The picture that cannot load keeps its name and its placeholder.
  const missing = emoji.filter({ has: page.getByRole("img", { name: "Missing star" }) });
  await expect.poll(() => missing.locator(":scope > img").evaluate((element: HTMLImageElement) => element.decode().then(() => "decoded", () => "failed"))).toBe("failed");
  await expect(missing).not.toHaveAttribute("data-loaded");
  await expect(missing.locator(":scope > img")).toHaveCSS("opacity", "0");
  await expect(missing.locator(':scope > [aria-hidden="true"]')).toBeVisible();
  // Every emoji drawn afresh shows its picture again once it has loaded.
  await page.getByRole("button", { name: "Load again" }).click();
  await expect(emoji.filter({ has: page.getByRole("img", { name: "Party popper" }) })).toHaveAttribute("data-loaded", "");
  await expect(page.getByRole("img", { name: "Party popper" })).toHaveCSS("opacity", "1");
});
