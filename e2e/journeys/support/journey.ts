// Base `test`/`expect` for the QA journeys, extended with two fixtures:
//   - verifyAfterReload(assertion): reloads the page and re-runs the assertion, so a
//     `@mutates` journey can prove its write survived a fresh document load.
//   - expectAccessible(): runs an axe scan of the whole page (default tags, no excluded
//     elements) and fails only on `serious`/`critical` impacts, printing rule ids and
//     target selectors for anything that fails.
//
// The axe injection itself (page.evaluate of the axe source, not an injected <script> tag,
// since QA's CSP would block that) lives in support/axe.ts and is shared with the explore
// suite, which records every violation instead of failing.
import { test as base, expect } from "@playwright/test";
import { runAxe } from "./axe";

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
      const results = await runAxe(page);

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
