import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";
import type {
  ActionFunctionArgs,
  AppLoadContext,
  EntryContext,
  LoaderFunctionArgs,
} from "react-router";
import { isRouteErrorResponse, ServerRouter } from "react-router";
import {
  captureException,
  resolvePostHogServerConfig,
} from "~/lib/analytics-server";
import { NonceContext } from "~/lib/nonce";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: AppLoadContext
) {
  let shellRendered = false;
  const userAgent = request.headers.get("user-agent");
  const env = loadContext.cloudflare?.env;
  const ctx = loadContext.cloudflare?.ctx;
  const postHogConfig = env ? resolvePostHogServerConfig(env) : { enabled: false as const, reason: "missing-key" as const };
  const requestUrl = new URL(request.url);

  const nonce = loadContext.nonce ?? "";
  const body = await renderToReadableStream(
    // `nonce` must go BOTH to NonceContext (theme-flash <script>, <Scripts>,
    // <ScrollRestoration> in root.tsx) AND to ServerRouter itself — React
    // Router's internal StreamTransfer emits its own inline hydration scripts
    // (window.__reactRouterContext…) that are nonced ONLY via this prop, not
    // via context. Omitting it leaves those scripts un-nonced → they'd be
    // blocked on every page by the enforcing CSP.
    <NonceContext.Provider value={nonce}>
      <ServerRouter context={routerContext} url={request.url} nonce={nonce} />
    </NonceContext.Provider>,
    {
      // React 19 injects streaming/resume bootstrap scripts outside React
      // Router's tree, so it needs the same nonce independently.
      nonce,
      onError(error: unknown) {
        responseStatusCode = 500;
        if (shellRendered) {
          console.error(error);
        }
        if (postHogConfig.enabled) {
          const capture = captureException(postHogConfig, {
            error,
            distinctId: "server",
            route: requestUrl.pathname,
            method: request.method,
          });
          if (ctx) {
            ctx.waitUntil(capture);
          } else {
            // Fire-and-forget without waitUntil; never throws by design.
            void capture;
          }
        }
      },
    }
  );
  shellRendered = true;

  if (isbot(userAgent || "")) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}

/**
 * React Router calls `handleError` for every error raised while handling a
 * request — crucially including loader/action throws that get caught and
 * rendered as an error boundary. The render-stream `onError` above only fires
 * for errors thrown during rendering, so without this export every HTML
 * loader/action failure (search/FTS reindex, D1 reads, account-settings
 * actions, …) produced an error page with zero telemetry.
 *
 * Expected client outcomes are skipped: thrown `Response`s (redirects,
 * `data(..., { status })`) never reach here, and bare route error responses
 * (`throw new Response(...)`, 404s) are filtered out — React Router only
 * forwards `ErrorResponse`s that carry an underlying thrown error. We guard
 * against both again so an expected 4xx is never recorded as an exception.
 *
 * Capture is wrapped in `ctx.waitUntil` so it never blocks or breaks the
 * error response.
 */
export function handleError(
  error: unknown,
  {
    request,
    context,
  }: {
    request: LoaderFunctionArgs["request"] | ActionFunctionArgs["request"];
    context: LoaderFunctionArgs["context"] | ActionFunctionArgs["context"];
  },
): void {
  // Expected client-visible outcomes are not exceptions.
  if (error instanceof Response) return;
  if (isRouteErrorResponse(error)) return;
  // Aborted requests (client navigated away) are not server failures.
  if (request.signal.aborted) return;

  const loadContext = context as AppLoadContext;
  const env = loadContext?.cloudflare?.env;
  const ctx = loadContext?.cloudflare?.ctx;
  if (!env) return;

  const postHogConfig = resolvePostHogServerConfig(env);
  if (!postHogConfig.enabled) return;

  const capture = captureException(postHogConfig, {
    error,
    distinctId: "server",
    route: new URL(request.url).pathname,
    method: request.method,
  });
  if (ctx) {
    ctx.waitUntil(capture);
  } else {
    // Fire-and-forget without waitUntil; never throws by design.
    void capture;
  }
}
