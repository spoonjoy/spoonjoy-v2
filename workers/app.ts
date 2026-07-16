import { createRequestHandler } from "react-router";
import { canonicalizeRequestUrlForHost } from "../app/lib/canonical-host.server";
import { handleMcpPostRouteRequest } from "../app/lib/mcp/http-mcp-route.server";
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

function finalizeResponse(
  response: Response,
  env: CloudflareEnvironment,
  nonce?: string,
): Response {
  const finalized = withSecurityHeaders(response, nonce, env);
  const workerVersionId = env.CF_VERSION_METADATA?.id;
  if (workerVersionId) {
    finalized.headers.set("X-Spoonjoy-Worker-Version", workerVersionId);
  }
  return finalized;
}

export default {
  async fetch(request, env, ctx) {
    const oauthPreflight = oauthCorsPreflightResponse(request);
    if (oauthPreflight) {
      return finalizeResponse(oauthPreflight, env);
    }

    const canonicalUrl =
      canonicalizeRequestUrlForHost(request.url, request.headers.get("X-Forwarded-Host")) ??
      canonicalizeRequestUrlForHost(request.url, request.headers.get("Host"));

    if (canonicalUrl) {
      return finalizeResponse(Response.redirect(canonicalUrl.toString(), 308), env);
    }

    try {
      if (request.method === "POST" && new URL(request.url).pathname === "/mcp") {
        const response = await handleMcpPostRouteRequest(request, {
          cloudflare: { env, ctx },
        });
        return finalizeResponse(response, env);
      }

      // One nonce per request: it must appear identically in the report-only
      // CSP header (below) and in the SSR shell's inline <script> nonces,
      // threaded via loadContext → entry.server → NonceContext.
      const nonce = generateNonce();
      const response = await requestHandler(request, {
        cloudflare: { env, ctx },
        nonce,
      });
      return finalizeResponse(response, env, nonce);
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
