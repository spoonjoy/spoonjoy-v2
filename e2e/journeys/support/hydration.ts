// expectNoHydrationErrors(page): fails if React reported a hydration mismatch, or any other error
// it recovered from, at any point in the page's life so far, as a console error or warning or as an
// uncaught page error (support/hydration-errors.ts says which messages count). The console gate
// fails a journey on console errors only at teardown; this asserts it at the step that matters,
// right after a server-rendered page hydrates, and also catches React's warnings.
import type { Page } from "@playwright/test";
import { expect } from "./journey";
import { hydrationErrorMessages } from "./hydration-errors";
import { redactUrlsInText } from "./redact";

export async function expectNoHydrationErrors(page: Page): Promise<void> {
  const consoleMessages = await page.consoleMessages({ filter: "all" });
  const pageErrors = await page.pageErrors({ filter: "all" });
  const messages = [
    ...consoleMessages
      .filter((message) => message.type() === "error" || message.type() === "warning")
      .map((message) => message.text()),
    ...pageErrors.map((error) => `${error.message}\n${error.stack ?? ""}`),
  ];
  expect(hydrationErrorMessages(messages).map(redactUrlsInText), "React hydration or recoverable errors").toEqual([]);
}
