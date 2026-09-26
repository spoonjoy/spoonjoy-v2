// Base `test`/`expect` for the QA journeys, extended with four fixtures:
//   - verifyAfterReload(assertion): reloads the page and re-runs the assertion, so a
//     `@mutates` journey can prove its write survived a fresh document load.
//   - expectAccessible(): runs an axe scan of the whole page (default tags, no excluded
//     elements) and fails only on `serious`/`critical` impacts, printing rule ids and
//     target selectors for anything that fails.
//   - expectConsoleError(pattern): registers, for the current test only, a RegExp that the
//     console gate below should treat as expected rather than a failure. A registered pattern
//     that never matches anything also fails the test, so a stale allowance can't linger.
//   - consoleGate: an `{ auto: true }` fixture that watches the test's own `page` for
//     console-error and pageerror events and fails the test at teardown, listing every
//     unexpected message, if any occurred. See watchConsole() below for the collection itself
//     and why a test that opens its own browser context (e.g. sign-in.journey.ts's logout
//     test) needs to call it directly.
//
// The axe injection itself (page.evaluate of the axe source, not an injected <script> tag,
// since QA's CSP would block that) lives in support/axe.ts and is shared with the explore
// suite, which records every violation instead of failing.
import { test as base, expect } from "@playwright/test";
import type { ConsoleMessage, Page } from "@playwright/test";
import { runAxe } from "./axe";
import { redactUrl, redactUrlsInText } from "./redact";

const FAILING_IMPACTS = new Set(["serious", "critical"]);

// Escape hatch for the console gate: a message (console error text, or a pageerror's message)
// matching any of these patterns is ignored, in every test, instead of failing it. Must start
// empty — a global allowance here should be rare and deliberate, never a default. Prefer a
// test's own expectConsoleError(pattern) for something expected in one specific test (it also
// fails if the pattern never matches, so it can't go stale); reach for this array only for
// noise that is expected everywhere. Example:
//   const ALLOWED_CONSOLE_ERRORS: RegExp[] = [/ResizeObserver loop limit exceeded/];
const ALLOWED_CONSOLE_ERRORS: RegExp[] = [];

interface ConsoleIssue {
  text: string;
  location?: string;
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
 * plain, no-allowances check the auto-used consoleGate fixture runs for the fixture-provided
 * `page`. A test that needs a per-test allowance for its own page should use
 * resolveConsoleIssues (also exported) instead, the way consoleGate does below.
 */
function assertNoConsoleIssues(issues: ConsoleIssue[]): void {
  if (issues.length === 0) return;
  throw new Error(`Console errors during test:\n${formatIssues(issues)}`);
}

/**
 * Appends a formatted list of `issues` to `error`'s message (mutating an Error in place, or
 * wrapping a non-Error thrown value) and returns it, or returns `error` unchanged if `issues`
 * is empty. Used where a test body already failed and console issues collected up to that
 * point should be surfaced alongside the original failure rather than replacing or hiding it.
 */
function appendConsoleIssues(error: unknown, issues: ConsoleIssue[]): unknown {
  if (issues.length === 0) return error;
  const report = `Console errors during test:\n${formatIssues(issues)}`;
  if (error instanceof Error) {
    error.message = `${error.message}\n\n${report}`;
    return error;
  }
  return new Error(`${String(error)}\n\n${report}`);
}

interface ExpectedConsolePattern {
  pattern: RegExp;
  matched: boolean;
}

/**
 * Splits `issues` into the ones no registered `expectations` pattern accounts for, and lists
 * which `expectations` (if any) never matched anything. Each expectation can absorb at most one
 * issue's worth of matching — this only affects which issue's text a pattern is credited
 * against when several would match, not whether the check passes.
 */
function resolveConsoleExpectations(
  issues: ConsoleIssue[],
  expectations: ExpectedConsolePattern[],
): { unmatched: ConsoleIssue[]; neverMatched: RegExp[] } {
  const unmatched = issues.filter((issue) => {
    const expectation = expectations.find((candidate) => !candidate.matched && candidate.pattern.test(issue.text));
    if (!expectation) return true;
    expectation.matched = true;
    return false;
  });
  const neverMatched = expectations.filter((expectation) => !expectation.matched).map((expectation) => expectation.pattern);
  return { unmatched, neverMatched };
}

/**
 * Fails if `issues` has anything no `expectations` pattern accounts for, or if an expectation
 * never matched anything (so a stale expectConsoleError(...) call is itself a failure, not a
 * silent no-op). Exported for the same reason as assertNoConsoleIssues: a test with its own
 * Page can run the identical check consoleGate runs for the fixture-provided `page`.
 */
function assertConsoleExpectationsMet(issues: ConsoleIssue[], expectations: ExpectedConsolePattern[]): void {
  const { unmatched, neverMatched } = resolveConsoleExpectations(issues, expectations);
  if (unmatched.length === 0 && neverMatched.length === 0) return;

  const parts: string[] = [];
  if (unmatched.length > 0) parts.push(`Console errors during test:\n${formatIssues(unmatched)}`);
  if (neverMatched.length > 0) {
    parts.push(
      `expectConsoleError() registered pattern(s) that never matched a console error:\n${neverMatched
        .map((pattern) => `  ${pattern}`)
        .join("\n")}`,
    );
  }
  throw new Error(parts.join("\n\n"));
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
 *
 * Both the message text and its source location are redacted the same way the explore suite
 * redacts recorded URLs (support/redact.ts): a console error can quote a failing request's
 * full URL in its text (for example a fetch/CSP failure), which can carry a query string or
 * other data that shouldn't end up verbatim in a test failure message or CI log.
 */
export function watchConsole(page: Page): ConsoleWatcher {
  const issues: ConsoleIssue[] = [];

  const onConsole = (message: ConsoleMessage) => {
    if (message.type() !== "error") return;
    const text = redactUrlsInText(message.text());
    if (isAllowed(text)) return;
    const url = message.location().url;
    issues.push({ text, location: url ? redactUrl(url) : undefined });
  };
  const onPageError = (error: Error) => {
    const text = redactUrlsInText(error.message);
    if (isAllowed(text)) return;
    issues.push({ text });
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

export { assertNoConsoleIssues, appendConsoleIssues };

export type VerifyAfterReload = (assertion: () => Promise<void>) => Promise<void>;
export type ExpectAccessible = () => Promise<void>;
export type ExpectConsoleError = (pattern: RegExp) => void;

interface JourneyFixtures {
  verifyAfterReload: VerifyAfterReload;
  expectAccessible: ExpectAccessible;
  expectConsoleError: ExpectConsoleError;
  // No public value; this fixture only exists for its auto-run teardown.
  consoleGate: void;
  // Internal: the per-test store expectConsoleError writes to and consoleGate reads from a
  // test should never depend on this fixture directly.
  consoleExpectations: ExpectedConsolePattern[];
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

  consoleExpectations: async ({}, use) => {
    const expectations: ExpectedConsolePattern[] = [];
    await use(expectations);
  },

  expectConsoleError: async ({ consoleExpectations }, use) => {
    await use((pattern: RegExp) => {
      consoleExpectations.push({ pattern, matched: false });
    });
  },

  consoleGate: [
    async ({ page, consoleExpectations }, use) => {
      const watcher = watchConsole(page);
      await use();
      watcher.dispose();
      assertConsoleExpectationsMet(watcher.issues, consoleExpectations);
    },
    { auto: true },
  ],
});

export { expect };
