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
// preload: false — axe's default preload behaviour fetches cross-origin stylesheets (here,
// the Google Fonts sheet linked in app/root.tsx) so colour-contrast checks can read font
// metrics from them. QA's CSP connect-src correctly blocks that fetch (the app only ever
// allows the stylesheet via style-src, never fetches it), which surfaced as a console error
// on every page ("Couldn't load preload assets: ProgressEvent") and failed the console gate
// in support/journey.ts. The app isn't at fault, so we don't touch its CSP; instead axe falls
// back to computed styles already present in the document for contrast checks, which is what
// every page here already has.
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
