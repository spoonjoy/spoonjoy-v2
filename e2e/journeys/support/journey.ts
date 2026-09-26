// Base `test`/`expect` for the QA journeys, extended with three fixtures:
//   - verifyAfterReload(assertion): reloads the page and re-runs the assertion, so a
//     `@mutates` journey can prove its write survived a fresh document load.
//   - expectAccessible(): runs an axe scan of the whole page (default tags, no excluded
//     elements) and fails only on `serious`/`critical` impacts, printing rule ids and
//     target selectors for anything that fails.
//   - consoleGate: an `{ auto: true }` fixture that watches the test's own `page` for
//     console-error and pageerror events and fails the test at teardown, listing every
//     message, if any occurred. See watchConsole() below for the collection itself and why
//     a test that opens its own browser context (e.g. sign-in.journey.ts's logout test)
//     needs to call it directly.
//
// The axe injection itself (page.evaluate of the axe source, not an injected <script> tag,
// since QA's CSP would block that) lives in support/axe.ts and is shared with the explore
// suite, which records every violation instead of failing.
import { test as base, expect } from "@playwright/test";
import type { ConsoleMessage, Page } from "@playwright/test";
import { runAxe } from "./axe";

const FAILING_IMPACTS = new Set(["serious", "critical"]);

// Escape hatch for the console gate: a message (console error text, or a pageerror's message)
// matching any of these patterns is ignored instead of failing the test. Must start empty —
// an allowance here should be rare and deliberate, never a default. Example:
//   const ALLOWED_CONSOLE_ERRORS: RegExp[] = [/ResizeObserver loop limit exceeded/];
const ALLOWED_CONSOLE_ERRORS: RegExp[] = [];

interface ConsoleIssue {
  text: string;
  location?: string;
}

// Drops the query string and fragment from a console message's source URL, matching the
// redaction the explore suite already does for the same reason: a location URL can carry
// search terms or tokens that shouldn't end up in a test failure message.
function stripQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split(/[?#]/)[0];
  }
}

function isAllowed(text: string): boolean {
  return ALLOWED_CONSOLE_ERRORS.some((pattern) => pattern.test(text));
}

function formatIssues(issues: ConsoleIssue[]): string {
  return issues
    .map((issue) => (issue.location ? `  ${issue.text}\n    at ${issue.location}` : `  ${issue.text}`))
    .join("\n");
}

/**
 * Fails with every collected console error / pageerror listed, or does nothing if there were
 * none. Exported so a test that owns its own Page (via watchConsole below) can run the same
 * check the auto-used consoleGate fixture runs for the fixture-provided `page`.
 */
function assertNoConsoleIssues(issues: ConsoleIssue[]): void {
  if (issues.length === 0) return;
  throw new Error(`Console errors during test:\n${formatIssues(issues)}`);
}

export interface ConsoleWatcher {
  /** Collected so far; read after the page under test is done with, right before disposing. */
  issues: ConsoleIssue[];
  /** Detaches this watcher's listeners. Call once the page is no longer needed. */
  dispose(): void;
}

/**
 * Attaches a console-error / pageerror collector to `page` and returns a handle to read it
 * back. The auto-used consoleGate fixture below calls this for every test's own `page`
 * fixture; a test that creates its own browser context (`browser.newContext()` /
 * `context.newPage()`) is not covered by that fixture, since the page it drives is never the
 * fixture's `page` — such a test should call watchConsole() itself on the page it creates, and
 * assert on watcher.issues (via assertNoConsoleIssues, re-exported below) before closing the
 * context.
 */
export function watchConsole(page: Page): ConsoleWatcher {
  const issues: ConsoleIssue[] = [];

  const onConsole = (message: ConsoleMessage) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (isAllowed(text)) return;
    const url = message.location().url;
    issues.push({ text, location: url ? stripQuery(url) : undefined });
  };
  const onPageError = (error: Error) => {
    if (isAllowed(error.message)) return;
    issues.push({ text: error.message });
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  return {
    issues,
    dispose() {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    },
  };
}

export { assertNoConsoleIssues };

export type VerifyAfterReload = (assertion: () => Promise<void>) => Promise<void>;
export type ExpectAccessible = () => Promise<void>;

interface JourneyFixtures {
  verifyAfterReload: VerifyAfterReload;
  expectAccessible: ExpectAccessible;
  // No public value; this fixture only exists for its auto-run teardown.
  consoleGate: void;
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

  consoleGate: [
    async ({ page }, use) => {
      const watcher = watchConsole(page);
      await use();
      watcher.dispose();
      assertNoConsoleIssues(watcher.issues);
    },
    { auto: true },
  ],
});

export { expect };
