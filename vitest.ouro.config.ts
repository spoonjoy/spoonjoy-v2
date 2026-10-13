import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { ouroTestProjects } from "./app/lib/ouro/testing/vitest.ts";

// Ouro UI's own tests, installed from its shadcn registry beside each component in
// app/components/ouro and app/lib/ouro. They run in real browsers (Chromium and WebKit, plus a
// 390x844 touch phone) through the projects Ouro UI ships for apps (ouroTestProjects), with
// Spoonjoy's stylesheet, so components render with Spoonjoy's theme mapping. The main suite
// (vitest.config.ts, happy-dom) leaves these files out and this run covers them to 100%.
//
// It stays on Spoonjoy's Vitest 4: the registry asks for Vitest 5, but
// @cloudflare/vitest-pool-workers (the Workers test lane) supports only Vitest 4.

// Vitest 4 scales the test iframe down when the page is smaller than the viewport a test asks for
// (Ouro's tests use up to 1280x844), which shifts real-mouse drags off their targets and makes
// sizes fractional. A page larger than any of those keeps the iframe at its true size. The touch
// project already sets its own 390x844 page.

// Ouro UI's tests are written for the stack its registry asks for (Vitest 5, Playwright 1.63).
// On Spoonjoy's (Vitest 4, Playwright 1.58) a few cannot pass, for reasons that are the test's and
// not the component's. Each is skipped by name, in its own file and only in the browsers where it
// fails: the file runs as its own project there, so a test of the same name in another file still
// runs. Undo each entry when Spoonjoy reaches the stack it names.
const STACK_SKIPS: { project: string; as: string; file: string; titles: string[] }[] = [
  // Vitest 4 sizes the test iframe with a CSS transform, even at scale(1), and under it the WebKit
  // of Playwright 1.58 measures 100dvh and 100lvh a fraction of a pixel short (811.999939px of
  // 812). Two sheet tests compare those exactly; they still run in Chromium and the touch project.
  // With Ouro UI v0.3.0 both fail on Playwright 1.58 and pass on Playwright 1.64 (PR #515's
  // Storybook runs).
  {
    project: "ouro-webkit",
    as: "ouro-webkit-sheet",
    file: "app/components/ouro/sheet/sheet.test.tsx",
    titles: [
      "sits at the bottom edge, fits its content and keeps clear of the top",
      "covers the visible screen on a page scrolled 2000px",
    ],
  },
  // The test fills getByRole("textbox", { name: "Name" }) beside a field labelled "Unnamed". A
  // role name matches as a substring, and Vitest 4 refuses a locator that finds two elements
  // ("strict mode violation"). test/ouro/form-unrelated-change.test.tsx makes the same check with
  // exact names, so the behaviour stays covered in both browsers.
  ...["ouro-chromium", "ouro-webkit"].map((project) => ({
    project,
    as: `${project}-form`,
    file: "app/components/ouro/form/form.test.tsx",
    titles: ["ignores a change in a field without a form error"],
  })),
];
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const skipping = (titles: string[]) => new RegExp(`^(?!.*(?:${titles.map(escapeRegExp).join("|")}))`);
const largePage = () => playwright({ contextOptions: { viewport: { width: 1600, height: 1200 } } });

const projects = ouroTestProjects({
  css: "./app/styles/tailwind.css",
  include: [
    "app/components/ouro/**/*.test.{ts,tsx}",
    "app/lib/ouro/**/*.test.{ts,tsx}",
    // Spoonjoy's own browser checks of how its stylesheet treats Ouro UI.
    "test/ouro/**/*.test.{ts,tsx}",
  ],
}).flatMap((project) => {
  if (project.test?.name === "ouro-touch") return [project];
  // Each project gets its own copy of the browser instances: Vitest names an instance in place
  // ("ouro-webkit (webkit)"), so two projects sharing one instance object would collide.
  const withLargePage = () => ({
    ...project.test,
    browser: {
      ...project.test?.browser,
      provider: largePage(),
      instances: project.test?.browser?.instances?.map((instance) => ({ ...instance })),
    },
  });
  const skips = STACK_SKIPS.filter((skip) => skip.project === project.test?.name);
  return [
    {
      ...project,
      test: { ...withLargePage(), exclude: [...(project.test?.exclude ?? []), ...skips.map((skip) => skip.file)] },
    },
    ...skips.map((skip) => ({
      ...project,
      test: { ...withLargePage(), name: skip.as, include: [skip.file], testNamePattern: skipping(skip.titles) },
    })),
  ];
});

// Stopgaps for two Ouro UI defects: tests of its own that pass but write to the console, which
// alone fails Spoonjoy's zero-warning run. Only these exact messages are dropped, so any other
// console output from Ouro UI's tests still fails.
const OURO_TEST_CONSOLE_NOISE = [
  // The Select test "is disabled and read-only on request" rerenders an uncontrolled Select with a
  // new defaultValue, and Base UI answers with this development message.
  "Base UI: A component is changing the default value state of an uncontrolled Select after being initialized.",
  // <TextArea autoGrow> changes its own height inside its ResizeObserver callback, so the browser
  // reports this when its width changes ("refits when its width changes and the text rewraps").
  // Spoonjoy renders no auto-growing TextArea.
  "ResizeObserver loop completed with undelivered notifications.",
];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./app", import.meta.url)),
      "@": fileURLToPath(new URL("./app/components", import.meta.url)),
    },
  },
  // Pre-bundle Base UI's entry points up front, as Ouro UI's own repository does: a dependency
  // Vite discovers mid-run triggers a re-optimization and reload, which can load React twice.
  optimizeDeps: {
    include: [
      "@base-ui/react/alert-dialog",
      "@base-ui/react/autocomplete",
      "@base-ui/react/button",
      "@base-ui/react/checkbox",
      "@base-ui/react/checkbox-group",
      "@base-ui/react/combobox",
      "@base-ui/react/dialog",
      "@base-ui/react/drawer",
      "@base-ui/react/field",
      "@base-ui/react/fieldset",
      "@base-ui/react/form",
      "@base-ui/react/radio",
      "@base-ui/react/radio-group",
      "@base-ui/react/select",
      "@base-ui/react/switch",
      "@base-ui/react/tooltip",
    ],
  },
  test: {
    projects,
    onConsoleLog: (log) => (OURO_TEST_CONSOLE_NOISE.some((noise) => log.includes(noise)) ? false : undefined),
    // Vitest prints a test that ran longer than this as "✓ <title> <n>ms", and the warning policy
    // rejects a line that reads as a warning. Ouro UI's titles come from its registry as they are
    // (one is "warn for appearance classes on parts"), so no title is ever printed as slow here.
    slowTestThreshold: 3_600_000,
    coverage: {
      provider: "istanbul",
      include: ["app/components/ouro/**/*.{ts,tsx}", "app/lib/ouro/**/*.{ts,tsx}"],
      // The same exclusions as Ouro UI's repository: stories, tests and the test kit itself.
      exclude: [
        "**/*.stories.tsx",
        "**/*.test.{ts,tsx}",
        "**/*.test-d.ts",
        "**/*.d.ts",
        "app/lib/ouro/testing/**",
        // Stopgap for an Ouro UI defect: its shared helpers arrive with three files that none of
        // the installed components imports (they serve Toast, Card and the popovers), and the
        // tests that cover them belong to those components. Take each out of this list when a
        // component that uses it is installed with its tests.
        "app/lib/ouro/toast.ts",
        "app/lib/ouro/stretched-link.ts",
        "app/lib/ouro/floating.ts",
      ],
      // Totals only: the per-file table would print use-dev-warnings.ts, a name the warning policy
      // rejects. Run `pnpm exec vitest run -c vitest.ouro.config.ts --coverage --coverage.reporter=text`
      // for the table.
      reporter: ["text-summary"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
