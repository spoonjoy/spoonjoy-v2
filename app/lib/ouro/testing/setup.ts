import { afterEach, beforeEach } from "vitest";

// Vitest setup for Ouro UI's browser tests: test output stays clean, so any React act()
// warning fails the test that caused it. Updates happen outside act by design (real
// browser events), so the act environment is off except inside the `act` helper
// (testing/act.ts). The app's stylesheet is a separate setup file (testing/vitest.ts).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

const ACT_WARNING = /not wrapped in act|not configured to support act/;
const seen: string[] = [];
const original = console.error;
console.error = (...args: unknown[]) => {
  const text = args.map(String).join(" ");
  if (ACT_WARNING.test(text)) seen.push(text.split("\n")[0]!);
  original.apply(console, args);
};

beforeEach(() => {
  seen.length = 0;
});

afterEach(() => {
  if (seen.length > 0) {
    const messages = seen.splice(0);
    throw new Error(`React act() warning in this test (test output must stay clean):\n${messages.join("\n")}`);
  }
});
