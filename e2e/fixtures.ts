import { expect, test as base, type BrowserContext } from "@playwright/test";
import {
  createBrowserDiagnosticCollector,
  observeBrowserContext,
  type BrowserContextLike,
} from "./warning-policy";

export interface BrowserWarningDiagnostics {
  expect(pattern: RegExp): void;
}

export async function runBrowserDiagnosticFixture(
  context: BrowserContext | BrowserContextLike,
  use: (diagnostics: BrowserWarningDiagnostics) => Promise<void>,
) {
  const collector = createBrowserDiagnosticCollector();
  observeBrowserContext(context as BrowserContextLike, collector);
  await use({ expect: (pattern) => collector.expectDiagnostic(pattern) });
  collector.assertClean("Browser emitted warning/error diagnostics");
}

export const test = base.extend<{ warningDiagnostics: BrowserWarningDiagnostics }>({
  warningDiagnostics: [
    async ({ context }, use) => runBrowserDiagnosticFixture(context, use),
    { auto: true },
  ],
});

export { expect };
