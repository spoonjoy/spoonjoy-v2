import type { Route } from "./+types/api.push.public-key";
import { getVapidConfig, type VapidEnv } from "~/lib/env.server";
import { captureException, resolvePostHogServerConfig } from "~/lib/analytics-server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = (context.cloudflare?.env ?? {}) as VapidEnv;
  try {
    const config = getVapidConfig(env);
    return Response.json(
      { key: config.publicKey },
      {
        status: 200,
        headers: { "Cache-Control": "public, max-age=3600" },
      },
    );
  } catch (err) {
    // A failed VAPID config read means push is misconfigured server-side — an
    // operator/infra fault the client cannot fix, not a client error. Capture it
    // (fire-and-forget, no-op without PostHog) before flattening to a 500.
    const postHogConfig = resolvePostHogServerConfig(context.cloudflare?.env ?? {});
    if (postHogConfig.enabled) {
      const capture = captureException(postHogConfig, {
        error: err,
        distinctId: "server",
        route: new URL(request.url).pathname,
        method: request.method,
        extras: { surface: "push_public_key" },
      });
      const waitUntil = context.cloudflare?.ctx?.waitUntil;
      if (waitUntil) {
        waitUntil.call(context.cloudflare!.ctx!, capture);
      } else {
        void capture;
      }
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "VAPID configuration error" },
      { status: 500 },
    );
  }
}
