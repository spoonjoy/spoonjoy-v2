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
 * What axe checks. "page" is the whole document with every rule. "story" is exactly what
 * Storybook's own a11y addon checks for a story (@storybook/addon-a11y's a11yRunner): the body
 * without Storybook's chrome, and without its one rule off by default, `region`, since a
 * component on its own is not in a page's landmarks. There is no other way to leave anything out.
 */
export type AxeTarget = "page" | "story";

const STORY = {
  include: [["body"]],
  exclude: [[".sb-wrapper"], ["#storybook-docs"], ["#storybook-highlights-root"]],
  rules: { region: { enabled: false } },
};

export async function runAxe(page: Page, target: AxeTarget = "page"): Promise<AxeResults> {
  await page.evaluate(axeSource);
  return page.evaluate(
    ({ story }) => {
      const axe = (window as unknown as { axe: typeof import("axe-core") }).axe;
      const context = story ? { include: story.include, exclude: story.exclude } : document;
      return axe.run(context, { resultTypes: ["violations", "incomplete"], preload: false, rules: story?.rules ?? {} });
    },
    { story: target === "story" ? STORY : null },
  ) as Promise<AxeResults>;
}
