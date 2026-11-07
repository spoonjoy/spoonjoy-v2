import { expect, test } from "../ouro-fixtures";
import { holdClock, openStory } from "./story";

test("the copy button puts its value on the clipboard and says Copied", async ({ page, browserName }) => {
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
  // The page's clock stands still until the spec moves it on, so the two-second confirmation
  // cannot end between the click and the check on a loaded runner.
  await page.clock.install();
  await openStory(page, "actions-copybutton--in-context");
  await holdClock(page);
  const button = page.getByRole("button", { name: "Copy key" });
  await button.click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const copied =
    browserName === "chromium"
      ? await page.evaluate(() => navigator.clipboard.readText())
      : await page.evaluate(() => (window as unknown as { copied: string[] }).copied[0]);
  expect(copied).toBe("pk_live_51Hx2vQ");
  await page.clock.runFor(1999);
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  await page.clock.runFor(1);
  await expect(page.getByRole("button", { name: "Copy key" })).toBeVisible();
});
