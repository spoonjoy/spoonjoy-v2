import { expect, test } from "../ouro-fixtures";
import { holdClock, openStory } from "./story";

test("a code block shows its caption and copies its code", async ({ page, browserName }) => {
  if (browserName === "chromium") {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  } else {
    // WebKit gives Playwright no clipboard to read, so the page's Clipboard API records what it is given.
    await page.addInitScript(() => {
      const copied: string[] = [];
      Object.defineProperty(window, "copied", { value: copied });
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => void copied.push(text) } });
    });
  }
  await page.clock.install();
  await openStory(page, "display-codeblock--in-context");
  const blocks = page.getByRole("figure");
  await expect(blocks).toHaveCount(2);
  await expect(blocks.nth(1).locator("figcaption")).toHaveText("vite.config.ts");
  // The caption names the figure; the copy button beside it does not.
  await expect(page.getByRole("figure", { name: "vite.config.ts", exact: true })).toBeVisible();
  // The two-second confirmation stays until the clock moves on.
  await holdClock(page);
  await blocks.first().getByRole("button", { name: "Copy code" }).click();
  await expect(blocks.first().getByRole("button", { name: "Copied" })).toBeVisible();
  const copied =
    browserName === "chromium"
      ? await page.evaluate(() => navigator.clipboard.readText())
      : await page.evaluate(() => (window as unknown as { copied: string[] }).copied[0]);
  expect(copied).toBe("npm install --save-dev vitest");
});
