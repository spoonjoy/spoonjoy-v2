import { buildHealthStatus } from "~/lib/health.server";

/**
 * Public liveness check. No auth, no DB — just the pure status payload.
 */
export function loader() {
  return Response.json(buildHealthStatus());
}
