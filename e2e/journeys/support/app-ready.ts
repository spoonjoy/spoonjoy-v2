// The app's ready signal for the journeys: <html data-hydrated>, which app/hooks/use-hydrated-mark.ts
// sets in an effect, so only after React has hydrated the whole page and attached its event
// handlers. React Router's window.__reactRouterDataRouter is not enough: it appears when hydration
// starts, and the app hydrates in a transition that can pause, so a tap in between can be lost
// (run 40239273524: an iPhone tap on search's Recipes scope link 1.3 s into the load started no
// navigation).
import type { APIResponse, Page, Route } from "@playwright/test";

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
  onRetry: (error: Error) => void = () => undefined,
): Promise<T> {
  const first = await load().then(
    (answer) => ({ answer }),
    (error: unknown) => {
      if (!isTransportFailure(error)) throw error;
      return { reset: error as Error };
    },
  );
  if (!("reset" in first)) return first.answer;
  onRetry(first.reset);
  await wait(TRANSPORT_RETRY_DELAY_MS);
  try {
    return await load();
  } catch (error) {
    // Keep the first reset with the second failure, so the report shows both.
    if (error instanceof Error && error.cause === undefined) error.cause = first.reset;
    throw error;
  }
}

// Printed in the test's output, so a load that needed a second try is on record in the report.
function reportLoadAgain(error: Error): void {
  console.warn(`Journeys: loading the page again after its connection was reset (${error.message.split("\n")[0]})`);
}

// Cloudflare's own static file serving, in front of the Worker, sometimes answers a built file
// under /assets/ with 502, 503 or 504 while the Worker's complete log shows no server error
// (Journeys runs 39850143035, 40362557353 and 40379638056). The file then never loads, so the page
// does not hydrate. These files are immutable and named by their content, so asking again repeats
// nothing. Other statuses, and the last try's answer, reach the page unchanged.
const RETRYABLE_ASSET_STATUSES = new Set([502, 503, 504]);
export const STATIC_ASSET_RETRY_DELAYS_MS: readonly number[] = [250, 1_000];

/** True for a built static file of the app under test: same origin, path under /assets/. */
export function isStaticAsset(url: URL, baseURL: string | undefined = process.env.SPOONJOY_JOURNEYS_BASE_URL): boolean {
  return baseURL !== undefined && url.origin === new URL(baseURL).origin && url.pathname.startsWith("/assets/");
}

type AssetRoute = Pick<Route, "fetch" | "fulfill" | "continue" | "request">;

/**
 * Answers a static file request, asking Cloudflare again, at most twice, while it answers 502, 503
 * or 504. When the request itself fails, the browser makes it as if nothing were routed.
 */
export async function answerStaticAsset(
  route: AssetRoute,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onRetry: (path: string, status: number, attempt: number) => void = reportAssetAgain,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    let response: APIResponse;
    try {
      response = await route.fetch();
    } catch {
      await route.continue().catch(() => undefined);
      return;
    }
    if (!RETRYABLE_ASSET_STATUSES.has(response.status()) || attempt >= STATIC_ASSET_RETRY_DELAYS_MS.length) {
      await route.fulfill({ response });
      return;
    }
    onRetry(new URL(route.request().url()).pathname, response.status(), attempt + 2);
    await wait(STATIC_ASSET_RETRY_DELAYS_MS[attempt]);
  }
}

function reportAssetAgain(path: string, status: number, attempt: number): void {
  console.warn(`Journeys: static file ${path} answered ${status}; asking again (try ${attempt} of ${STATIC_ASSET_RETRY_DELAYS_MS.length + 1})`);
}

/**
 * Makes every page.goto and page.reload on this page wait for hydration as well as the load, so a
 * journey's first tap reaches the app, and load once more after a reset connection
 * (loadAgainAfterTransportFailure), and routes the app's static files through answerStaticAsset,
 * which turns off the browser's HTTP cache for this page. A load with waitUntil "commit" is not
 * waited on: it is how a journey types into the server's markup before hydration on purpose.
 * support/journey.ts applies this to the fixture's page; a journey that opens its own page applies
 * it there.
 */
export function waitForHydrationOnLoad(page: Page): void {
  const goto = page.goto.bind(page);
  const reload = page.reload.bind(page);
  const assetsRouted = page.route((url) => isStaticAsset(url), (route) => answerStaticAsset(route));
  // Awaited by the first load; a page closed before any load must not leave it unhandled.
  assetsRouted.catch(() => undefined);
  page.goto = async (url, options) => {
    await assetsRouted;
    const response = await loadAgainAfterTransportFailure(() => goto(url, options), undefined, reportLoadAgain);
    if (options?.waitUntil !== "commit") await waitForHydrationIfApp(page);
    return response;
  };
  page.reload = async (options) => {
    await assetsRouted;
    const response = await loadAgainAfterTransportFailure(() => reload(options), undefined, reportLoadAgain);
    if (options?.waitUntil !== "commit") await waitForHydrationIfApp(page);
    return response;
  };
}
