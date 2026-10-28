// Shared axe-core injection for the QA journeys, the explore suite and the Storybook check. Runs axe-core directly
// instead of through @axe-core/playwright: the axe source is injected with
// page.evaluate(axeSource) rather than an injected <script> tag (page.addScriptTag), since QA
// enforces a Content-Security-Policy that would block an injected script tag; page.evaluate
// runs in the page's context but is not itself subject to the page's CSP.
//
// support/accessibility.ts runs it for the journeys' expectAccessible(), the explore survey and
// the Storybook check, and fails on every violation and every check axe could not decide.
//
// preload: false — by default axe fetches assets (stylesheets' CSSOM, media metadata) for the
// handful of rules whose metadata declares `preload: true` (in axe-core 4.13: css-orientation-
// lock and no-autoplay-audio); every other rule runs immediately without waiting on that fetch.
// Here it fetched the Google Fonts sheet linked in app/root.tsx, which QA's CSP connect-src
// correctly blocks (the app only ever allows that stylesheet via style-src and never fetches
// it itself); the blocked fetch is what produced a console error on every page ("Couldn't load
// preload assets: ProgressEvent") and failed the console gate in support/journey.ts. Contrast
// checking (color-contrast) does not declare `preload: true` and was never part of that
// fetch — it already reads computed styles the browser has resolved, so preload: false does
// not weaken it. The app isn't at fault here, so we don't touch its CSP; we just stop axe
// making a request the CSP was always going to block.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import type { AxeResults } from "axe-core";

const require = createRequire(import.meta.url);

export const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

/**
 * What axe checks. "page" is the whole document with every rule. "story" is what Storybook's
 * own a11y addon checks for a story (@storybook/addon-a11y's a11yRunner), the body without
 * Storybook's chrome, but with every rule: the addon turns `region` off, and the story check
 * keeps it, since it renders each story in a page's <main> (.storybook/preview.tsx). Both leave
 * out Base UI's focus guards and nothing else.
 */
export type AxeTarget = "page" | "story";

/**
 * Left out of every scan, as Ouro UI's gate leaves them out (`axeExclude` in
 * app/lib/ouro/testing/axe.ts, which runs only under Vitest's browser mode, so it is copied here
 * and e2e/storybook/gate.spec.ts keeps the two the same). Base UI's focus guards around an open
 * popup are visually hidden and never reached by Tab; in WebKit they take an unnamed
 * role="button" on purpose, so VoiceOver's cursor lands on them and the popup's focus trap
 * catches it.
 */
export const AXE_EXCLUDE = ["[data-base-ui-focus-guard]"];

const PAGE = { exclude: AXE_EXCLUDE.map((selector) => [selector]) };

const STORY = {
  include: [["body"]],
  exclude: [[".sb-wrapper"], ["#storybook-docs"], ["#storybook-highlights-root"], ...PAGE.exclude],
};

export async function runAxe(page: Page, target: AxeTarget = "page"): Promise<AxeResults> {
  await page.evaluate(axeSource);
  return page.evaluate(
    (context) => {
      const axe = (window as unknown as { axe: typeof import("axe-core") }).axe;
      return axe.run(context, { resultTypes: ["violations", "incomplete"], preload: false });
    },
    target === "story" ? STORY : PAGE,
  ) as Promise<AxeResults>;
}
