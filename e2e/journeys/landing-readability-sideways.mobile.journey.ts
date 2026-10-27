// The signed-out landing hero is readable on phones held sideways (read-only, signed out, both
// themes), with the same check as landing-readability.journey.ts (support/landing-readability.ts).
// Sideways, the hero's text and actions sit higher on the photo, where the bottom shade is thinner
// (landing-first-screen.mobile.journey.ts). The 13 mini's Safari page (712 x 327) puts the actions
// highest on the photo; the Duo's outer screen (531 x 382) puts "Search Recipes" furthest right,
// where the side shade is thinnest. Only the phone project runs it: a desktop browser at these sizes
// draws at one pixel per CSS px, which a phone never does.
import { test } from "./support/journey";
import { heroIsReadable } from "./support/landing-readability";

for (const { name, viewport } of [
  { name: "an iPhone 13 mini held sideways", viewport: { width: 712, height: 327 } },
  { name: "the iPhone Duo's outer screen held sideways", viewport: { width: 531, height: 382 } },
]) {
  test.describe(`Signed-out landing hero readability on ${name}`, () => {
    test.use({ storageState: { cookies: [], origins: [] }, viewport });

    test("every hero text and action is readable in the light theme", async ({ page }, testInfo) => {
      await heroIsReadable(page, testInfo, "light");
    });

    test("every hero text and action is readable in the dark theme", async ({ page }, testInfo) => {
      await heroIsReadable(page, testInfo, "dark");
    });
  });
}
