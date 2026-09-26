// Base `test`/`expect` for the QA journeys, extended with two fixtures:
//   - verifyAfterReload(assertion): reloads the page and re-runs the assertion, so a
//     `@mutates` journey can prove its write survived a fresh document load.
//   - expectAccessible(): runs an axe scan of the whole page (default tags, no excluded
//     elements) and fails only on `serious`/`critical` impacts, printing rule ids and
//     target selectors for anything that fails.
//
// Runs axe-core directly instead of through @axe-core/playwright: the axe source is injected
// with page.evaluate(axeSource) rather than an injected <script> tag (page.addScriptTag), since
// QA enforces a Content-Security-Policy that would block an injected script tag; page.evaluate
// runs in the page's context but is not itself subject to the page's CSP.
import { test as base, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type { AxeResults } from "axe-core";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const FAILING_IMPACTS = new Set(["serious", "critical"]);

export type VerifyAfterReload = (assertion: () => Promise<void>) => Promise<void>;
export type ExpectAccessible = () => Promise<void>;

interface JourneyFixtures {
  verifyAfterReload: VerifyAfterReload;
  expectAccessible: ExpectAccessible;
}

export const test = base.extend<JourneyFixtures>({
  verifyAfterReload: async ({ page }, use) => {
    await use(async (assertion) => {
      await page.reload({ waitUntil: "load" });
      await assertion();
    });
  },

  expectAccessible: async ({ page }, use) => {
    await use(async () => {
      await page.evaluate(axeSource);
      const results = await page.evaluate(
        () => (window as unknown as { axe: typeof import("axe-core") }).axe.run(document, {
          resultTypes: ["violations"],
        }),
      ) as AxeResults;

      const failing = results.violations.filter((violation) => FAILING_IMPACTS.has(violation.impact ?? ""));

      if (failing.length > 0) {
        const report = failing
          .map((violation) => {
            const targets = violation.nodes.map((node) => node.target.join(" ")).join(", ");
            return `  [${violation.impact}] ${violation.id}: ${targets}`;
          })
          .join("\n");
        throw new Error(`Accessibility violations (serious/critical impact):\n${report}`);
      }
    });
  },
});

export { expect };
