// Ouro UI tests that race the clock on a shared CI runner, so they fail pull requests whose change
// they never read. They run outside the required Ouro UI step, in Storybook's non-blocking
// "Ouro UI timing tests" step (.github/workflows/storybook.yml), until Ouro UI makes them wait for
// the browser's own events or bounds them generously (ourostack/ouro-ui#3518). The tests are Ouro UI's, installed with it,
// so this list is Spoonjoy's and an Ouro update leaves it alone. Each name is the test's describe
// and its title, as Vitest joins them.
export const OURO_TIMING_QUARANTINE = [
  {
    file: "app/components/ouro/text-field/text-field.weight.test.tsx",
    describe: "TextField's mount time",
    test: "mounts a plain field, one of 100, in a bounded multiple of the time a bare input takes, one of 5,000",
    // It mounts 100 fields and 5,000 bare inputs six times each. WebKit takes 10 to 12 s of its 15 s
    // test timeout when it passes, and timed out on #973 (Storybook run 45332755372) and #1020 (45418767727).
    why: "a wall-clock ratio whose run nears its 15 s timeout in WebKit",
  },
  {
    file: "app/components/ouro/avatar/avatar.weight.test.tsx",
    describe: "Avatar's mount time",
    test: "mounts a group chat avatar, one of 100, in a bounded multiple of the time a bare span takes, one of 5,000",
    why: "the same wall-clock ratio, with the same mounts against the same 15 s timeout",
  },
  {
    file: "app/components/ouro/collapsible/collapsible.test.tsx",
    describe: "Collapsible",
    test: "animates the panel open with a grid row, and not with reduced motion",
    // It reads the computed transition straight after emulating reduced motion, before WebKit has
    // applied it (#1020, Storybook run 45418767727 attempt 2).
    why: "reads the style once, without waiting for the emulated media to apply",
  },
] as const;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const names = () => OURO_TIMING_QUARANTINE.map(({ describe, test }) => escape(`${describe} ${test}`)).join("|");

/**
 * Vitest's testNamePattern for the Ouro UI run: with "only", just the quarantined tests; otherwise
 * every test but them. Vitest matches it against the test's full name (its file, describes and title).
 */
export function ouroTimingTestNamePattern(mode: string | undefined): RegExp {
  return mode === "only" ? new RegExp(`(?:${names()})$`) : new RegExp(`^(?!.*(?:${names()})$)`);
}
