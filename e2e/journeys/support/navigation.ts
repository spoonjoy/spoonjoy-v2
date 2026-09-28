// Small navigation helpers shared by the round-trip journeys.
import type { Locator, Page } from "@playwright/test";

// React Router sets this global while hydrating the document, after React's root event listeners
// exist. Waiting for it after a full document load means the next tap goes through the app
// (client-side navigation, with React Router's history index) rather than a pre-hydration full
// page load, which would start a new in-app history.
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => "__reactRouterDataRouter" in window);
}

// The root layout registers the service worker once per full page load until a registration
// completes. A registration still in flight when the page navigates away is cancelled, and WebKit
// logs that as a console error ("Script .../sw.js load failed ... due to access control checks"),
// which fails the console gate. A journey that makes several full page loads in quick succession
// waits for the first registration to finish, after which no later load registers again.
export async function waitForServiceWorker(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
}

// A link to one seeded recipe, matched by its accessible name and its href together. A page can
// link the same recipe more than once (the kitchen home's featured tile has a photo link and a
// title link), so this takes the first match; the href keeps unrelated QA recipes with a similar
// title out.
export function recipeLink(scope: Locator, title: string, recipePath: string): Locator {
  return scope
    .getByRole("link", { name: new RegExp(title) })
    .and(scope.page().locator(`[href="${recipePath}"]`))
    .first();
}

// A link to one seeded recipe where it is listed once (search results, the /recipes list), matched
// by its exact accessible name and its href together. Another recipe can share the seeded title
// (a journey's throwaway fork of Lemon Herb Rice lives until the run's cleanup, and journeys run
// in parallel), so the name alone is not enough; the href is the seeded id.
export function seededRecipeLink(scope: Locator, name: string, recipePath: string): Locator {
  return scope.getByRole("link", { name, exact: true }).and(scope.page().locator(`[href="${recipePath}"]`));
}

// Matches a full URL whose path is exactly `path`, with any query or hash.
export function pathUrl(path: string): RegExp {
  const escaped = path.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`^https?://[^/]+${escaped}(?:[?#].*)?$`);
}
