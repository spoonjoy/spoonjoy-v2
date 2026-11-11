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

/**
 * True when a page.goto or page.reload failed because its connection was reset before any answer.
 * Playwright puts the failure on the message's first line; later lines are its call log.
 */
export function isTransportFailure(error: unknown): boolean {
  return error instanceof Error && !error.name.includes("Timeout") && TRANSPORT_FAILURE.test(error.message.split("\n")[0]);
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
// scripts/warning-gate.ts lets these notes through (JOURNEYS_RETRY_NOTE_PATTERN): a retry that
// worked must not fail the step.
export function loadRetryNote(error: Error): string {
  return `Journeys: loading the page again after its connection was reset (${error.message.split("\n")[0]})`;
}

function reportLoadAgain(error: Error): void {
  console.warn(loadRetryNote(error));
}

// Cloudflare's own static file serving, in front of the Worker, sometimes answers a built file
// under /assets/ with 502, 503 or 504 while the Worker's complete log shows no server error
// (Journeys runs 39850143035, 40362557353 and 40379638056). The file then never loads, so the page
// does not hydrate. These files are immutable and named by their content, so asking again repeats
// nothing. Other statuses, and the last try's answer, reach the page unchanged.
const RETRYABLE_ASSET_STATUSES = new Set([502, 503, 504]);
export const STATIC_ASSET_RETRY_DELAYS_MS: readonly number[] = [250, 1_000];

/**
 * How long a routed request waits for an answer. Without a limit, a request whose connection hangs
 * waits for as long as the test runs, as in Journeys run 43070915438 (#666), where a built file
 * and a /recipes.data each waited until their test ended while the run's Worker logged nothing
 * stalled. The run's slowest Worker answer took 4.9 s. A data request with no answer twice takes
 * twice this plus a second, under the 15 s a journey's URL and visibility checks wait.
 */
export const ROUTED_FETCH_TIMEOUT_MS = 6_000;

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
      response = await route.fetch({ timeout: ROUTED_FETCH_TIMEOUT_MS });
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

export function assetRetryNote(path: string, status: number, attempt: number): string {
  return `Journeys: static file ${path} answered ${status}; asking again (try ${attempt} of ${STATIC_ASSET_RETRY_DELAYS_MS.length + 1})`;
}

function reportAssetAgain(path: string, status: number, attempt: number): void {
  console.warn(assetRetryNote(path, status, attempt));
}

// A React Router data request (a form submission's action, or a navigation's loaders: the
// `.data` URLs) that lost its connection before any answer, as in Journeys runs 43057324617 and
// 43063219006 (#666): the runner's connection to Cloudflare's edge was reset while the run's Worker
// answered every request it finished, with no server error. The browser then logs "Failed to load
// resource" and the journey fails on a page that did nothing wrong. Routed through Playwright, the
// request is made by Node, which words a dropped connection like this. An answer of any status is
// not one, and neither is any other error.
const FETCH_TRANSPORT_FAILURE = /\b(?:ECONNRESET|EPIPE)\b|socket hang up|Client network socket disconnected before secure TLS connection was established/;

/** True when route.fetch had no answer within its timeout. */
export function isFetchTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError" && /^route\.fetch: Timeout \d+ms exceeded\.$/.test(error.message.split("\n")[0]);
}

const SAFE_METHODS = new Set(["GET", "HEAD"]);

/** True when route.fetch failed because its connection dropped before any answer. */
export function isFetchTransportFailure(error: unknown): boolean {
  return error instanceof Error && !error.name.includes("Timeout") && FETCH_TRANSPORT_FAILURE.test(error.message.split("\n")[0]);
}

export const DATA_REQUEST_RETRY_DELAY_MS = 1_000;

type DataRoute = Pick<Route, "fetch" | "fulfill" | "abort" | "request">;

/**
 * Answers a data request, sending it once more, a second later, when its connection dropped
 * before any answer, as a person on a flaky connection would submit again. It is sent at most
 * twice. A GET or HEAD with no answer within ROUTED_FETCH_TIMEOUT_MS is sent once more too; a
 * submission with none is not, since the Worker may be applying it. A submission is not always
 * idempotent, but one whose connection dropped before an answer may never have reached the
 * Worker, and a journey checks what the page shows next, so a submission applied twice still
 * fails it. Every answer reaches the page unchanged, redirects included, though whole rather than
 * streamed: the app has no deferred loader data, and one that streams would need this revisited.
 * When both tries fail, or the request fails any other way, the page's fetch fails as a lost request ("Failed to
 * fetch" in Chromium, "Load failed" in WebKit, both app/lib/network-failure.ts's), so the app's own
 * handling runs. Unlike answerStaticAsset, it never falls back to route.continue(), which would
 * send a submission a hidden third time. Playwright's own route.fetch({ maxRetries }) retries only
 * ECONNRESET, and silently, so it is not used.
 */
export async function answerDataRequest(
  route: DataRoute,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onRetry: (method: string, path: string, error: Error) => void = reportDataRequestAgain,
): Promise<void> {
  const options = { maxRedirects: 0, timeout: ROUTED_FETCH_TIMEOUT_MS };
  let response: APIResponse;
  try {
    response = await route.fetch(options);
  } catch (error) {
    const request = route.request();
    const unanswered = isFetchTimeout(error) && SAFE_METHODS.has(request.method());
    if (!unanswered && !isFetchTransportFailure(error)) {
      await route.abort("connectionreset").catch(() => undefined);
      return;
    }
    onRetry(request.method(), new URL(request.url()).pathname, error as Error);
    await wait(DATA_REQUEST_RETRY_DELAY_MS);
    try {
      response = await route.fetch(options);
    } catch {
      await route.abort("connectionreset").catch(() => undefined);
      return;
    }
  }
  await route.fulfill({ response });
}

export function dataRequestRetryNote(method: string, path: string, error: Error): string {
  const why = isFetchTimeout(error) ? "it had no answer" : "its connection was reset";
  return `Journeys: sending ${method} ${path} again after ${why} (${error.message.split("\n")[0]})`;
}

function reportDataRequestAgain(method: string, path: string, error: Error): void {
  console.warn(dataRequestRetryNote(method, path, error));
}

/** The app's data requests on `origin`: every path ending in `.data`, with any query. */
export function dataRequestPattern(origin: string): RegExp {
  return new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/[^?#]*\\.data(?:[?#]|$)`);
}

/**
 * Makes every page.goto and page.reload on this page wait for hydration as well as the load, so a
 * journey's first tap reaches the app, and load once more after a reset connection
 * (loadAgainAfterTransportFailure), and routes the app's static files through answerStaticAsset and
 * its data requests through answerDataRequest, which turns off the browser's HTTP cache for this
 * page. A load with waitUntil "commit" is not
 * waited on: it is how a journey types into the server's markup before hydration on purpose.
 * support/journey.ts applies this to the fixture's page; a journey that opens its own page applies
 * it there.
 */
export function waitForHydrationOnLoad(page: Page): void {
  const goto = page.goto.bind(page);
  const reload = page.reload.bind(page);
  // A glob, not a function: Playwright pauses every request a function matcher might match.
  const base = process.env.SPOONJOY_JOURNEYS_BASE_URL;
  const assetsRouted = base
    ? Promise.all([
        page.route(`${new URL(base).origin}/assets/**`, (route) => answerStaticAsset(route)),
        // A RegExp, like a glob, is handed to Playwright to match, so other requests are not paused.
        page.route(dataRequestPattern(new URL(base).origin), (route) => answerDataRequest(route)),
      ])
    : Promise.resolve();
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
