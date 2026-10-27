// The signed-out landing hero is readable (read-only, signed out, both themes). Its eyebrow,
// heading, description and three actions sit on a food photo under a dark gradient, so their
// contrast depends on the photo, not just the theme's tokens. "Log in" and "Search Recipes" used to
// be outline buttons with the page's dark ink and border on that dark photo. Coverage is checked
// too; landing-first-screen.mobile.journey.ts checks the actions on a phone's first screen, and
// landing-readability-sideways.mobile.journey.ts runs this check on phones held sideways. What it
// measures is described in support/landing-readability.ts.
import { test } from "./support/journey";
import { heroIsReadable } from "./support/landing-readability";

test.describe("Signed-out landing hero readability", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("every hero text and action is readable in the light theme", async ({ page }, testInfo) => {
    await heroIsReadable(page, testInfo, "light");
  });

  test("every hero text and action is readable in the dark theme", async ({ page }, testInfo) => {
    await heroIsReadable(page, testInfo, "dark");
  });
});
