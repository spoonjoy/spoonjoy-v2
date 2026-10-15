import { afterAll, afterEach } from "vitest";

// Vitest setup for Ouro UI's browser tests: test output stays clean, so anything a test
// writes to the console fails that test: a React act() warning, a development message from
// Ouro UI or Base UI, a stray console.log. A test that expects a message mocks the method
// (`vi.spyOn(console, "warn").mockImplementation(() => {})`) and asserts on the mock, so
// nothing is printed. Updates happen outside act by design (real browser events), so the act
// environment is off except inside the `act` helper (testing/act.ts). The app's stylesheet
// is a separate setup file (testing/vitest.ts).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

/**
 * A browser reports "ResizeObserver loop completed with undelivered notifications" as a window
 * error when a resize callback changes layout, as a measuring component does (Base UI's toast).
 * It is a notice about timing, not a failure. Vitest prints it with
 * `console.error(new Error(message))`; that one call is dropped, so it neither prints nor fails.
 * The cost: these tests cannot catch a component of ours that raises the notice, so a test for
 * one listens for the window's "error" event itself.
 */
const isResizeNotice = (value: unknown) => String((value as { message?: unknown } | null | undefined)?.message ?? "").startsWith("ResizeObserver loop");

// Every method that prints. `assert` prints only when its condition is false.
const methods = ["debug", "log", "info", "warn", "error", "trace", "table", "dir", "dirxml", "group", "groupCollapsed", "assert"] as const;
type Method = (typeof methods)[number];
type Print = (...args: unknown[]) => void;
const target = console as unknown as Record<Method, Print>;
const seen: string[] = [];
const guards = {} as Record<Method, Print>;
for (const method of methods) {
  const original = target[method];
  guards[method] = (...args: unknown[]) => {
    if (isResizeNotice(args[0])) return;
    if (method === "assert" && args[0]) return;
    seen.push(`console.${method}: ${args.map(String).join(" ").split("\n")[0]!}`);
    original.apply(console, args);
  };
  target[method] = guards[method];
}

/** Fails with what was printed since the last check, and with any method a test left mocked. */
function check(when: string): void {
  // A mock left on a console method would switch this guard off for every later test in the
  // file. Vitest runs a setup file's afterEach after the test file's own, so a mock still in
  // place here was never restored: put the guard back and say so.
  const mocked = methods.filter((method) => target[method] !== guards[method]);
  for (const method of mocked) target[method] = guards[method];
  const messages = seen.splice(0);
  if (mocked.length > 0) {
    throw new Error(
      `${mocked.map((method) => `console.${method}`).join(", ")} was still mocked ${when}. Restore it (vi.restoreAllMocks() in afterEach), or the mock hides the console output of later tests.`,
    );
  }
  if (messages.length > 0) {
    throw new Error(
      `Console output ${when} (test output must stay clean; mock the console method if the message is expected):\n${messages.join("\n")}`,
    );
  }
}

// Nothing clears `seen` between tests: output while a file loads, or between two tests, fails
// the next test, and output after the last test fails the file.
afterEach(() => check("in this test"));
afterAll(() => check("after this file's last test"));
