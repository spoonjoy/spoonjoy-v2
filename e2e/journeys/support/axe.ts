// Shared axe-core injection for the QA journeys and the explore suite. Runs axe-core directly
// instead of through @axe-core/playwright: the axe source is injected with
// page.evaluate(axeSource) rather than an injected <script> tag (page.addScriptTag), since QA
// enforces a Content-Security-Policy that would block an injected script tag; page.evaluate
// runs in the page's context but is not itself subject to the page's CSP.
//
// `journey.ts`'s expectAccessible() fails on serious/critical violations; app.explore.ts
// records every violation of every impact instead, since explore never asserts app behaviour.
// Both read the same injected axe source, so this is the one place that owns it.
//
// preload: false — by default axe fetches assets (stylesheets' CSSOM, media metadata) for the
// handful of rules whose metadata declares `preload: true` (in axe-core 4.11: css-orientation-
// lock and no-autoplay-audio); every other rule runs immediately without waiting on that fetch.
// Here it fetched the Google Fonts sheet linked in app/root.tsx, which QA's CSP connect-src
// correctly blocks (the app only ever allows that stylesheet via style-src and never fetches
// it itself); the blocked fetch is what produced a console error on every page ("Couldn't load
// preload assets: ProgressEvent") and failed the console gate in support/journey.ts. Contrast
// checking (color-contrast) does not declare `preload: true` and was never part of that
// fetch — it already reads computed styles the browser has resolved, so preload: false does
// not weaken it. The app isn't at fault here, so we don't touch its CSP; we just stop axe
// making a request the CSP was always going to block.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import type { AxeResults } from "axe-core";

const require = createRequire(import.meta.url);

export const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

export async function runAxe(page: Page): Promise<AxeResults> {
  await page.evaluate(axeSource);
  return page.evaluate(
    () => (window as unknown as { axe: typeof import("axe-core") }).axe.run(document, {
      resultTypes: ["violations"],
      preload: false,
    }),
  ) as Promise<AxeResults>;
}
