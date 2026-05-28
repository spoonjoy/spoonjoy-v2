import { createRequestHandler } from "react-router";
import { canonicalizeRequestUrlForHost } from "../app/lib/canonical-host.server";
import {
  captureException,
  resolvePostHogServerConfig,
} from "../app/lib/analytics-server";

declare global {
  interface CloudflareEnvironment extends Env {}
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

export default {
  async fetch(request, env, ctx) {
    const canonicalUrl =
      canonicalizeRequestUrlForHost(request.url, request.headers.get("X-Forwarded-Host")) ??
      canonicalizeRequestUrlForHost(request.url, request.headers.get("Host"));

    if (canonicalUrl) {
      return Response.redirect(canonicalUrl.toString(), 308);
    }

    try {
      return await requestHandler(request, {
        cloudflare: { env, ctx },
      });
    } catch (error) {
      // Outer catch: errors that escaped React Router's onError (e.g. thrown
      // before the response stream started, or from a non-route boundary).
      const postHogConfig = resolvePostHogServerConfig(env);
      if (postHogConfig.enabled) {
        ctx.waitUntil(
          captureException(postHogConfig, {
            error,
            distinctId: "server",
            route: new URL(request.url).pathname,
            method: request.method,
          }),
        );
      }
      throw error;
    }
  },
} satisfies ExportedHandler<CloudflareEnvironment>;
