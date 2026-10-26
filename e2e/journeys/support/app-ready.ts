// The app's ready signal for the journeys: <html data-hydrated>, which app/hooks/use-hydrated-mark.ts
// sets in an effect, so only after React has hydrated the whole page and attached its event
// handlers. React Router's window.__reactRouterDataRouter is not enough: it appears when hydration
// starts, and the app hydrates in a transition that can pause, so a tap in between can be lost
// (run 40239273524: an iPhone tap on search's Recipes scope link 1.3 s into the load started no
// navigation).
import type { Page } from "@playwright/test";

/** Waits until React has finished hydrating the page's current document. */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.hasAttribute("data-hydrated"));
}

// After the load event every inline script has run, so a document without React Router's context
// is not an app page (a JSON route, /offline.html) and has nothing to wait for.
async function waitForHydrationIfApp(page: Page): Promise<void> {
  await page.waitForFunction(() => !("__reactRouterContext" in window) || document.documentElement.hasAttribute("data-hydrated"));
}

/**
 * Makes every page.goto and page.reload on this page wait for hydration as well as the load, so a
 * journey's first tap reaches the app. A load with waitUntil "commit" is left alone: it is how a
 * journey types into the server's markup before hydration on purpose. support/journey.ts applies
 * this to the fixture's page; a journey that opens its own page applies it there.
 */
export function waitForHydrationOnLoad(page: Page): void {
  const goto = page.goto.bind(page);
  const reload = page.reload.bind(page);
  page.goto = async (url, options) => {
    const response = await goto(url, options);
    if (options?.waitUntil !== "commit") await waitForHydrationIfApp(page);
    return response;
  };
  page.reload = async (options) => {
    const response = await reload(options);
    if (options?.waitUntil !== "commit") await waitForHydrationIfApp(page);
    return response;
  };
}
