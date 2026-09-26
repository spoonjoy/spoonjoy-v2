// Shared axe-core injection for the QA journeys and the explore suite. Runs axe-core directly
// instead of through @axe-core/playwright: the axe source is injected with
// page.evaluate(axeSource) rather than an injected <script> tag (page.addScriptTag), since QA
// enforces a Content-Security-Policy that would block an injected script tag; page.evaluate
// runs in the page's context but is not itself subject to the page's CSP.
//
// `journey.ts`'s expectAccessible() fails on serious/critical violations; app.explore.ts
// records every violation of every impact instead, since explore never asserts app behaviour.
// Both read the same injected axe source, so this is the one place that owns it.
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
    }),
  ) as Promise<AxeResults>;
}
