import type { Route } from "./+types/health.ready";
import { checkReadiness, type ReadinessEnv } from "~/lib/health.server";
import { getCloudflareEnv } from "~/lib/route-platform.server";

/**
 * Public readiness check for uptime monitoring: touches D1 and R2 and returns
 * 503 when either is unreachable. `/health` remains the no-dependency liveness
 * check that the release pipeline uses.
 */
export async function loader({ context }: Route.LoaderArgs) {
  const env = getCloudflareEnv(context);
  // The app's hand-written binding types (app/cloudflare-env.d.ts) leave D1
  // untyped and omit R2 head(); the runtime bindings provide both.
  const readiness = await checkReadiness({
    DB: env?.DB as ReadinessEnv["DB"],
    PHOTOS: env?.PHOTOS as unknown as ReadinessEnv["PHOTOS"],
  });
  return Response.json(readiness, {
    status: readiness.status === "ready" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
