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

// A document load that never got an HTTP answer because the connection between the runner and
// Cloudflare's edge was cut: the TCP connection or its TLS handshake was reset (Journeys runs
// 40588634127 and 40592921397, while the run's Worker tail dropped too). Chrome words it
// net::ERR_CONNECTION_RESET or _CLOSED, WebKit "Connection reset by peer". An answer of any status,
// and a timeout, are not transport failures.
const TRANSPORT_FAILURE = /Connection reset by peer|Peer failed to perform TLS handshake|net::ERR_(?:CONNECTION_(?:RESET|CLOSED)|SSL_PROTOCOL_ERROR)\b/;

/** True when a page.goto or page.reload failed because its connection was reset before any answer. */
export function isTransportFailure(error: unknown): boolean {
  return error instanceof Error && !error.name.includes("Timeout") && TRANSPORT_FAILURE.test(error.message);
}

export const TRANSPORT_RETRY_DELAY_MS = 1_000;

/**
 * Loads once more, after a second, when the first load's connection was reset before any answer.
 * A document load is a GET, so loading it again repeats nothing, and a person would reload too.
 * The second failure, and every other failure, is thrown. The console gate excuses the first
 * load's "Failed to load resource" log only because the same URL was then answered
 * (support/recovered-requests.ts).
 */
export async function loadAgainAfterTransportFailure<T>(
  load: () => Promise<T>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (!isTransportFailure(error)) throw error;
    await wait(TRANSPORT_RETRY_DELAY_MS);
    return load();
  }
}

/**
 * Makes every page.goto and page.reload on this page wait for hydration as well as the load, so a
 * journey's first tap reaches the app, and load once more after a reset connection
 * (loadAgainAfterTransportFailure). A load with waitUntil "commit" is not waited on: it is how a
 * journey types into the server's markup before hydration on purpose. support/journey.ts applies
 * this to the fixture's page; a journey that opens its own page applies it there.
 */
export function waitForHydrationOnLoad(page: Page): void {
  const goto = page.goto.bind(page);
  const reload = page.reload.bind(page);
  page.goto = async (url, options) => {
    const response = await loadAgainAfterTransportFailure(() => goto(url, options));
    if (options?.waitUntil !== "commit") await waitForHydrationIfApp(page);
    return response;
  };
  page.reload = async (options) => {
    const response = await loadAgainAfterTransportFailure(() => reload(options));
    if (options?.waitUntil !== "commit") await waitForHydrationIfApp(page);
    return response;
  };
}
