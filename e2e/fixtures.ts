import { expect, test as base, type BrowserContext } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
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
    async ({ context }, use, info) => {
      const network: unknown[] = [];
      context.on("requestfailed", (request) => network.push({
        at: Date.now(), event: "requestfailed", url: request.url(),
        resource: request.resourceType(), failure: request.failure(),
      }));
      context.on("response", (response) => {
        if (response.status() >= 400) network.push({
          at: Date.now(), event: "response", url: response.url(), status: response.status(),
        });
      });
      context.on("page", (page) => {
        page.on("console", (message) => {
          if (message.type() === "warning" || message.type() === "error") network.push({
            at: Date.now(), event: "console", type: message.type(),
            text: message.text(), location: message.location(), page: page.url(),
          });
        });
        page.on("framenavigated", (frame) => network.push({
          at: Date.now(), event: "navigation", url: frame.url(),
        }));
      });
      try {
        await runBrowserDiagnosticFixture(context, use);
      } finally {
        if (network.some((event) => (event as { event: string }).event !== "navigation")) {
          const directory = join(process.env.RUNNER_TEMP!, "b2-native");
          await mkdir(directory, { recursive: true });
          await writeFile(join(directory, `network-${randomUUID()}.json`),
            JSON.stringify({ test: info.titlePath, network }, null, 2));
        }
      }
    },
    { auto: true },
  ],
});

export { expect };
