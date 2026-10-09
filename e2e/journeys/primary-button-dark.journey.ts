// The primary button in dark mode (read-only, signed out). The header's Sign Up button used to put
// a light label on the amber at 2.61:1; the theme now gives it a dark label, a lighter amber on
// hover and named colours when disabled (test/styles/primary-button-contrast.test.ts checks the
// tokens). This journey checks the rendered colours on the real login page, scans the page with
// axe in dark mode, and saves a screenshot of each state at 390 px (iPhone) and 1280 px (desktop),
// plus the top of the signed-out home page.
import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "./support/journey";
import { waitForHydration } from "./support/navigation";

// The dark theme's tokens, as the browser reports them.
const LABEL = "rgb(31, 29, 26)"; // --sj-on-action: --sj-charcoal, #1f1d1a
const REST = "rgb(185, 133, 75)"; // --sj-action, #b9854b
const HOVER = "rgb(204, 154, 98)"; // --sj-action-hover, #cc9a62
const DISABLED = "rgb(70, 61, 51)"; // --sj-action-disabled, #463d33
const DISABLED_LABEL = "rgb(200, 192, 180)"; // --sj-on-action-disabled: --sj-charcoal-soft, #c8c0b4

function viewportFor(testInfo: TestInfo) {
  return testInfo.project.name === "iphone-webkit" ? { width: 390, height: 844 } : { width: 1280, height: 800 };
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const width = viewportFor(testInfo).width;
  await testInfo.attach(`primary-button-dark-${name}-${width}`, {
    body: await page.screenshot({ animations: "disabled" }),
    contentType: "image/png",
  });
}

test.describe("Primary button in dark mode", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("each state keeps a readable label on the login page", async ({ page, expectAccessible }, testInfo) => {
    await page.setViewportSize(viewportFor(testInfo));
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/login");
    await waitForHydration(page);
    const logIn = page.getByRole("button", { name: "Log In", exact: true });
    // On a phone the Log In button is below the first screen; centre it so each screenshot shows it.
    await logIn.evaluate((element) => element.scrollIntoView({ block: "center" }));

    // Rest: a dark label on the amber, and nothing on the page fails axe, the header's Sign Up included.
    await expect(logIn).toHaveCSS("background-color", REST);
    await expect(logIn).toHaveCSS("color", LABEL);
    await capture(page, testInfo, "login-rest");
    await expectAccessible();

    // Hover lightens the amber, so the dark label keeps its contrast.
    await logIn.hover();
    await expect(logIn).toHaveCSS("background-color", HOVER);
    await expect(logIn).toHaveCSS("color", LABEL);
    await capture(page, testInfo, "login-hover");

    // Keyboard focus keeps the rest colours and adds the brass ring outside the button.
    await page.mouse.move(0, 0);
    await page.keyboard.press("Tab");
    await logIn.focus();
    await expect(logIn).toHaveAttribute("data-focus", "");
    await expect(logIn).toHaveCSS("outline-style", "solid");
    await expect(logIn).toHaveCSS("background-color", REST);
    await capture(page, testInfo, "login-focus");

    // No signed-out page shows a disabled primary button, so the journey disables this one to show
    // the disabled colours: a muted fill and label, not a 50% fade.
    await logIn.evaluate((element) => {
      element.setAttribute("disabled", "");
      element.setAttribute("data-disabled", "");
      (element as HTMLElement).blur();
    });
    await expect(logIn).toHaveCSS("background-color", DISABLED);
    await expect(logIn).toHaveCSS("color", DISABLED_LABEL);
    await expect(logIn).toHaveCSS("opacity", "1");
    await capture(page, testInfo, "login-disabled");
  });

  test("the top of the signed-out home page", async ({ page, expectAccessible }, testInfo) => {
    await page.setViewportSize(viewportFor(testInfo));
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await waitForHydration(page);
    await expect(page.getByRole("banner")).toBeVisible();
    await capture(page, testInfo, "home-top");
    await expectAccessible();
  });
});
