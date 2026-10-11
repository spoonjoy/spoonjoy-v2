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
// Vitest 4 also sizes the test iframe with a CSS transform, even at scale(1), and under it the
// WebKit of Playwright 1.58 measures 100dvh and 100lvh a fraction of a pixel short (811.999939px of
// 812). Two sheet tests compare those exactly, so in WebKit sheet.test.tsx runs as its own project
// that skips exactly those two; they still run in Chromium and the touch project. Every other file,
// including the dialog's test of the same name, runs in WebKit in full. With Ouro UI v0.3.0 both
// still fail on Playwright 1.58 and both pass on Playwright 1.64 (PR #515's Storybook runs), so
// undo this when Spoonjoy moves to Playwright 1.64 or later.
const WEBKIT_SHEET_TESTS = "app/components/ouro/sheet/sheet.test.tsx";
const WEBKIT_SKIPPED_ON_PLAYWRIGHT_1_58 =
  /^(?!.*(?:sits at the bottom edge, fits its content and keeps clear of the top|covers the visible screen on a page scrolled 2000px))/;
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
  if (project.test?.name !== "ouro-webkit") return [{ ...project, test: withLargePage() }];
  return [
    {
      ...project,
      test: { ...withLargePage(), exclude: [...(project.test.exclude ?? []), WEBKIT_SHEET_TESTS] },
    },
    {
      ...project,
      test: {
        ...withLargePage(),
        name: "ouro-webkit-sheet",
        include: [WEBKIT_SHEET_TESTS],
        testNamePattern: WEBKIT_SKIPPED_ON_PLAYWRIGHT_1_58,
      },
    },
  ];
});

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
    include: ["@base-ui/react/button", "@base-ui/react/dialog", "@base-ui/react/drawer"],
  },
  test: {
    projects,
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
      ],
      // Totals only: the per-file table would print use-dev-warnings.ts, a name the warning policy
      // rejects. Run `pnpm exec vitest run -c vitest.ouro.config.ts --coverage --coverage.reporter=text`
      // for the table.
      reporter: ["text-summary"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
