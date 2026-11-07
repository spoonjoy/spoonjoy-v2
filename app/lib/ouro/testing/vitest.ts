import { playwright } from "@vitest/browser-playwright";
import { fileURLToPath } from "node:url";
import { configDefaults, type TestProjectInlineConfiguration } from "vitest/config";
// Relative and with its extension, not `@/…`: Vitest loads this file with its config, which
// Node runs directly (Vite's native config loader), before any alias applies.
import { commands } from "./commands.ts";

export interface OuroTestOptions {
  /**
   * The app's stylesheet, the file `components.json` names in `tailwind.css`
   * (for example `"./src/index.css"`). It loads before every test, so components
   * render with the app's theme.
   * @claim "It loads before every test, so" scripts/testing-kit.test.mjs verify:testExists(scripts/testing-kit.test.mjs::ouroTestProjects leaves the page size to Vitest unless the app sets one)
   * @claim "It loads before every test, so" registry/ouro/lib/ouro/testing/vitest.ts verify:fileLine(registry/ouro/lib/ouro/testing/vitest.ts, /const\ssetupFiles\s=\s\[css,/)
   */
  css: string;
  /**
   * Test files, relative to the project root. Default: every test under an `ouro/` folder.
   *
   * @claim "Default: every test under an `ouro/`" registry/ouro/lib/ouro/testing/vitest.ts verify:fileLine(registry/ouro/lib/ouro/testing/vitest.ts, /include\s=\s\["\*\*\/ouro\/\*\*\/\*\.test\.\{ts,tsx\}"\]/)
   */
  include?: string[];
  /** Browsers for the main projects. Default: Chromium and WebKit. */
  browsers?: Array<"chromium" | "webkit">;
  /**
   * The size of the Playwright host page for every project. Set it on Vitest 4:
   * `page: { width: 1600, height: 1200 }`. Vitest 4 scales the test frame down when the
   * page is smaller than the viewport a test asks for (the tests ask for up to 1280x844),
   * which moves real-mouse drags off their targets and makes sizes fractional; a larger page
   * keeps the frame at its true size, including a phone frame rotated to landscape.
   * Vitest 5 needs none. The touch test frame still starts at 390x844 with mobile/touch
   * input; this option changes its host's outer window, screen size and orientation,
   * not the test frame's logical viewport. These host metrics do not measure a physical phone.
   * @claim "Vitest 4 scales the test frame" scripts/testing-kit.test.mjs verify:testExists(scripts/testing-kit.test.mjs::page sizes every Playwright host while the touch frame keeps its phone viewport and input)
   * @claim "Vitest 4 scales the test frame" scripts/testing-kit.test.mjs verify:testExists(scripts/testing-kit.test.mjs::ouroTestProjects leaves the page size to Vitest unless the app sets one)
   * @claim "The size of the Playwright host" scripts/testing-kit.test.mjs verify:testExists(scripts/testing-kit.test.mjs::page sizes every Playwright host while the touch frame keeps its phone viewport and input)
   * @claim "Vitest 5 needs none" scripts/testing-kit.test.mjs verify:testExists(scripts/testing-kit.test.mjs::ouroTestProjects leaves the page size to Vitest unless the app sets one)
   * @claim "The touch test frame still starts" scripts/testing-kit.test.mjs verify:testExists(scripts/testing-kit.test.mjs::page sizes every Playwright host while the touch frame keeps its phone viewport and input)
   */
  page?: { width: number; height: number };
}

/**
 * Vitest browser projects that run Ouro UI's tests in your app: one project per
 * browser, plus `ouro-touch` (Chromium as a 390x844 touch phone) for files named
 * `*.touch.test.tsx`. They register Ouro UI's browser commands (`drag`, `flick`, `tap`,
 * `touchDrag`, `touchStep`, `emulateMedia`, `pointerPress`, `pageZoom`, `resetPageZoom`, `setPageZoom`,
 * `restoreTouch`) and the setup that fails a test on anything it writes to the console (a React act() warning, a development message). In `ouro-touch`, a test
 * that leaves the page zoomed fails too (rotate the viewport with `rotate` from testing/rotate.ts),
 * and every test starts with touch emulation on, even after a failure's screenshot dropped it.
 * `pressTint` from testing/press.ts holds the mouse down on an element and proves its `:active` tint.
 * Each project extends your root config, so your Vite plugins and aliases apply. Needs
 * Playwright's browsers: `npx playwright install chromium webkit`. Needs Vitest 4.1.11 or
 * later; on Vitest 4, pass `page` (https://ui.ouro.bot/docs/testing.md).
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
 * @claim "In `ouro-touch`, a test that leaves" scripts/testing-kit.test.mjs verify:testExists(scripts/testing-kit.test.mjs::page sizes every Playwright host while the touch frame keeps its phone viewport and input)
 * @claim "In `ouro-touch`, a test that leaves" registry/ouro/lib/ouro/testing/vitest.ts verify:fileLine(registry/ouro/lib/ouro/testing/vitest.ts, /viewport:\s\{\swidth:\s390,\sheight:\s844\s\}/)
 * @claim "Vitest browser projects that run Ouro" registry/ouro/lib/ouro/testing/touch-setup.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/touch-setup.touch.test.ts::the next test starts as a touch phone again)
 * @claim "In `ouro-touch`, a test that leaves" registry/ouro/lib/ouro/testing/touch-setup.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/touch-setup.touch.test.ts::the next test starts as a touch phone again)
 * @claim "Needs Vitest 4.1.11 or later; on" registry/ouro/lib/ouro/testing/rotate.touch.test.ts verify:testExists(registry/ouro/lib/ouro/testing/rotate.touch.test.ts::the next test starts at zoom 1 in portrait)
 * @claim "Each project extends your root config" registry/ouro/lib/ouro/testing/vitest.ts verify:fileLine(registry/ouro/lib/ouro/testing/vitest.ts, /extends:\strue\sas\sconst,/)
 * @claim "Each project extends your root config" https://vitest.dev/guide/projects verify:urlOk(https://vitest.dev/guide/projects)
 */
export function ouroTestProjects({
  css,
  include = ["**/ouro/**/*.test.{ts,tsx}"],
  browsers = ["chromium", "webkit"],
  page,
}: OuroTestOptions): TestProjectInlineConfiguration[] {
  const setupFiles = [css, fileURLToPath(new URL("./setup.ts", import.meta.url))];
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
        browser: {
          enabled: true,
          headless: true,
          provider: page ? playwright({ contextOptions: { viewport: page } }) : playwright(),
          instances: [{ browser }],
          commands,
        },
      },
    })),
    {
      extends: true as const,
      test: {
        name: "ouro-touch",
        setupFiles: [...setupFiles, fileURLToPath(new URL("./touch-setup.ts", import.meta.url))],
        expect: expectOptions,
        include: touchInclude,
        browser: {
          enabled: true,
          headless: true,
          provider: playwright({
            contextOptions: { hasTouch: true, isMobile: true, viewport: page ?? { width: 390, height: 844 } },
            // A frame of another site in a process of its own, as in desktop Chrome: the headless
            // shell otherwise runs every frame in the page's, so the touch kit's handling of such
            // frames would go untested (commands.touch.test.ts).
            launchOptions: { args: ["--site-per-process"] },
          }),
          instances: [{ browser: "chromium" as const }],
          viewport: { width: 390, height: 844 },
          commands,
        },
      },
    },
  ];
}
