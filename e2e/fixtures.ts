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
      const records: Array<Record<string, unknown>> = [];
      const consoleReads: Promise<void>[] = [];
      const selected = (type: string, url: string) =>
        ["xhr", "fetch", "stylesheet", "font"].includes(type) || !url.startsWith("http://127.0.0.1:6006");
      context.on("request", (request) => {
        if (selected(request.resourceType(), request.url())) records.push({
          at: Date.now(), event: "request", url: request.url(), type: request.resourceType(),
        });
      });
      context.on("requestfailed", (request) => records.push({
        at: Date.now(), event: "requestfailed", url: request.url(), type: request.resourceType(),
        failure: request.failure(),
      }));
      context.on("response", (response) => {
        if (response.status() >= 400 || selected(response.request().resourceType(), response.url())) records.push({
          at: Date.now(), event: "response", url: response.url(), status: response.status(),
          type: response.request().resourceType(),
          accessControlAllowOrigin: response.headers()["access-control-allow-origin"] ?? null,
        });
      });
      const observePage = (page: import("@playwright/test").Page) => {
        const id = randomUUID();
        page.on("framenavigated", (frame) => records.push({
          at: Date.now(), event: "navigation", page: id, url: frame.url(),
        }));
        page.on("console", (message) => {
          if (message.type() !== "warning" && message.type() !== "error") return;
          const record: Record<string, unknown> = {
            at: Date.now(), event: "console", page: id, url: page.url(),
            type: message.type(), text: message.text(), location: message.location(),
          };
          records.push(record);
          consoleReads.push(Promise.all(message.args().map((arg) => arg.evaluate((value) => {
            if (value === null || typeof value !== "object") return value;
            const target = "target" in value ? value.target : null;
            return {
              kind: Object.prototype.toString.call(value),
              type: "type" in value ? value.type : null,
              timeStamp: "timeStamp" in value ? value.timeStamp : null,
              target: target && typeof target === "object" ? {
                kind: Object.prototype.toString.call(target),
                properties: Object.fromEntries(["readyState", "status", "responseURL"].flatMap((key) =>
                  key in target ? [[key, Reflect.get(target, key)]] : [])),
              } : null,
            };
          }))).then(
            (args) => { record.args = args; },
            (error: unknown) => { record.argumentReadError = String(error); },
          ));
        });
      };
      for (const page of context.pages()) observePage(page);
      context.on("page", observePage);
      try {
        await runBrowserDiagnosticFixture(context, use);
      } finally {
        await Promise.all(consoleReads);
        const styleSheets = await Promise.all(context.pages().map(async (page) => ({
          url: page.url(),
          result: await page.evaluate(() => [...document.styleSheets]
            .filter((sheet) => sheet.href?.startsWith("https://fonts.googleapis.com/"))
            .map((sheet) => {
              try {
                return {
                  href: sheet.href, rules: sheet.cssRules.length,
                  crossOrigin: (sheet.ownerNode as HTMLLinkElement).crossOrigin,
                };
              } catch (error) {
                return { href: sheet.href, error: String(error) };
              }
            })).catch((error: unknown) => ({ evaluationError: String(error) })),
        })));
        const directory = join(process.env.RUNNER_TEMP!, "axe-network");
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, `test-${randomUUID()}.json`),
          JSON.stringify({ test: info.titlePath, repeatEachIndex: info.repeatEachIndex, records, styleSheets }, null, 2));
      }
    },
    { auto: true },
  ],
});

export { expect };
