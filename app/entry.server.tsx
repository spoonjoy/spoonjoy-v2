import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";
import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import {
  captureException,
  resolvePostHogServerConfig,
} from "~/lib/analytics-server";

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

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
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
