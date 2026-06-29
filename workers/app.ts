import { createRequestHandler } from "react-router";
import { canonicalizeRequestUrlForHost } from "../app/lib/canonical-host.server";
import { oauthCorsPreflightResponse } from "../app/lib/oauth-cors.server";
import { generateNonce, withSecurityHeaders } from "../app/lib/security-headers.server";
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
    const oauthPreflight = oauthCorsPreflightResponse(request);
    if (oauthPreflight) {
      return withSecurityHeaders(oauthPreflight);
    }

    const canonicalUrl =
      canonicalizeRequestUrlForHost(request.url, request.headers.get("X-Forwarded-Host")) ??
      canonicalizeRequestUrlForHost(request.url, request.headers.get("Host"));

    if (canonicalUrl) {
      return withSecurityHeaders(Response.redirect(canonicalUrl.toString(), 308));
    }

    try {
      // One nonce per request: it must appear identically in the report-only
      // CSP header (below) and in the SSR shell's inline <script> nonces,
      // threaded via loadContext → entry.server → NonceContext.
      const nonce = generateNonce();
      const response = await requestHandler(request, {
        cloudflare: { env, ctx },
        nonce,
      });
      return withSecurityHeaders(response, nonce);
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
