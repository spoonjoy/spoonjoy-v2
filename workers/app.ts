import { createRequestHandler } from "react-router";
import { canonicalizeRequestUrlForHost } from "../app/lib/canonical-host.server";

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

    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
} satisfies ExportedHandler<CloudflareEnvironment>;
