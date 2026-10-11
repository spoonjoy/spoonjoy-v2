import { playwright } from "@vitest/browser-playwright";
import { configDefaults, type TestProjectInlineConfiguration } from "vitest/config";
// Relative and with its extension, not `@/…`: Vitest loads this file with its config, which
// Node runs directly (Vite's native config loader), before any alias applies.
import { commands } from "./commands.ts";

export interface OuroTestOptions {
  /**
   * The app's stylesheet, the file `components.json` names in `tailwind.css`
   * (for example `"./src/index.css"`). It loads before every test, so components
   * render with the app's theme.
   */
  css: string;
  /** Test files, relative to the project root. Default: every test under an `ouro/` folder. */
  include?: string[];
  /** Browsers for the main projects. Default: Chromium and WebKit. */
  browsers?: Array<"chromium" | "webkit">;
}

/**
 * Vitest browser projects that run Ouro UI's tests in your app: one project per
 * browser, plus `ouro-touch` (Chromium as a 390x844 touch phone) for files named
 * `*.touch.test.tsx`. They register Ouro UI's browser commands (`drag`, `flick`,
 * `tap`, `emulateMedia`, `pointerPress`) and the setup that fails a test on any
 * React act() warning. Each project extends your root config, so your Vite plugins
 * and aliases apply. Needs Playwright's browsers: `npx playwright install chromium webkit`.
 *
 * @example
 * // vitest.config.ts
 * import { defineConfig, mergeConfig } from "vitest/config";
 * import viteConfig from "./vite.config.ts";
 * import { ouroTestProjects } from "./src/lib/ouro/testing/vitest.ts";
 *
 * export default mergeConfig(viteConfig, defineConfig({
 *   test: { projects: ouroTestProjects({ css: "./src/index.css" }) },
 * }));
 */
export function ouroTestProjects({
  css,
  include = ["**/ouro/**/*.test.{ts,tsx}"],
  browsers = ["chromium", "webkit"],
}: OuroTestOptions): TestProjectInlineConfiguration[] {
  const setupFiles = [css, decodeURIComponent(new URL("./setup.ts", import.meta.url).pathname)];
  const touchInclude = include.map((glob) => glob.replace(/\.test\.(\{[^}]*\}|\w+)$/, ".touch.test.$1"));
  const exclude = [...configDefaults.exclude, "**/*.touch.test.{ts,tsx}", "**/*.visual.test.{ts,tsx}"];
  // Tests wait on conditions (`expect.poll`), never on fixed timers. A loaded CI runner
  // can take seconds to finish a 750ms spring, so a poll gives up only after 10s.
  const expectOptions = { poll: { timeout: 10_000 } };
  return [
    ...browsers.map((browser) => ({
      extends: true as const,
      test: {
        name: `ouro-${browser}`,
        setupFiles,
        expect: expectOptions,
        include,
        exclude,
        browser: { enabled: true, headless: true, provider: playwright(), instances: [{ browser }], commands },
      },
    })),
    {
      extends: true as const,
      test: {
        name: "ouro-touch",
        setupFiles,
        expect: expectOptions,
        include: touchInclude,
        browser: {
          enabled: true,
          headless: true,
          provider: playwright({
            contextOptions: { hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } },
          }),
          instances: [{ browser: "chromium" as const }],
          viewport: { width: 390, height: 844 },
          commands,
        },
      },
    },
  ];
}
