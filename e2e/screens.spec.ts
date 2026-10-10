import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Screens: full-page captures of the main pages at phone and desktop sizes, in light and dark,
// signed out and signed in. CI uploads screens/ as the `screens` artifact on every pull request,
// so a visual change can be reviewed from its own build without running the app locally. A pull
// request that changes a page not listed here adds it to SIGNED_OUT or SIGNED_IN.
// The captures are evidence for review, not a pixel comparison; a page that fails to load fails.

const EMPTY_STORAGE = { cookies: [], origins: [] };
const OUT = "screens";

const SIGNED_OUT = ["/", "/recipes", "/search", "/chefs", "/login", "/signup"];
const SIGNED_IN = ["/", "/recipes", "/my-recipes", "/cookbooks", "/shopping-list", "/account/settings"];

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
] as const;
const SCHEMES = ["light", "dark"] as const;

function slug(path: string) {
  return path === "/" ? "home" : path.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-");
}

// List images below the first screen are loading="lazy", so a full-page capture taken from the
// top shows them as empty boxes. Scroll the whole page first, then wait until every image has
// either loaded or failed, so the capture shows what a reader who scrolled would see.
async function loadEveryImage(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    window.scrollTo(0, 0);
  });
  await page
    .waitForFunction(() => Array.from(document.images).every((image) => image.complete), undefined, { timeout: 10_000 })
    .catch(() => undefined);
}

mkdirSync(OUT, { recursive: true });

for (const [state, paths] of [["signed-out", SIGNED_OUT], ["signed-in", SIGNED_IN]] as const) {
  for (const scheme of SCHEMES) {
    test.describe(`screens: ${state}, ${scheme}`, () => {
      test.use({ colorScheme: scheme, ...(state === "signed-out" ? { storageState: EMPTY_STORAGE } : {}) });

      for (const viewport of VIEWPORTS) {
        test(`captures ${state} pages on ${viewport.name} in ${scheme}`, async ({ page }) => {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          for (const path of paths) {
            const response = await page.goto(path);
            expect(response?.status(), `${path} should load`).toBeLessThan(400);
            await page.waitForLoadState("networkidle");
            await loadEveryImage(page);
            await page.screenshot({
              path: `${OUT}/${state}-${slug(path)}-${viewport.name}-${scheme}.png`,
              fullPage: true,
              animations: "disabled",
            });
          }
        });
      }
    });
  }
}
