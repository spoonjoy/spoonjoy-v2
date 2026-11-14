// The registry leaves this file to the app. Retain Spoonjoy's zero-diagnostics fixture.
import { expect, test as base } from "./fixtures";

/** A story link's target: a page path, not Storybook's iframe or one of its files. */
function isStoryLinkTarget(url: URL): boolean {
  return url.pathname !== "/iframe.html" && !/\.[a-z0-9]+$/i.test(url.pathname);
}

// ShowMore (v1.3.33) measures every fold in one ResizeObserver and commits in its callback, which
// WebKit reports as "ResizeObserver loop completed with undelivered notifications". HX's own test
// setup treats that as a timing notice, not a failure (app/lib/ouro/testing/setup.ts); its specs
// here allow it, and only it (ourostack/ouro-ui#1201).
const showMoreSpec = /[\\/]e2e[\\/]ouro[\\/]show-more\.spec\.ts$/;
const resizeLoopNotice = /^pageerror: [^\n]*ResizeObserver loop completed with undelivered notifications\.?$/;

export const test = base.extend<{ storyLinks: void; showMoreResizeNotice: void }>({
  showMoreResizeNotice: [
    async ({ warningDiagnostics }, use, testInfo) => {
      if (showMoreSpec.test(testInfo.file)) warningDiagnostics.allow(resizeLoopNotice);
      await use();
    },
    { auto: true },
  ],
  // Some of Ouro UI's specs follow a story's link (Cookbooks, to /cookbooks) and check the address.
  // The static Storybook has no such page and answers 404, which the browser logs as an error;
  // answering the navigation with an empty page keeps the diagnostics clean and the address the same.
  storyLinks: [
    async ({ context }, use) => {
      await context.route(isStoryLinkTarget, async (route) => {
        if (!route.request().isNavigationRequest()) return route.fallback();
        await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Story link</title>" });
      });
      await use();
    },
    { auto: true },
  ],
});

export { expect };
