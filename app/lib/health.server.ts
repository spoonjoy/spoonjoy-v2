/**
 * Health/liveness status for the public `GET /health` endpoint.
 *
 * Pure and dependency-free so the uptime check stays trivially testable and
 * never touches auth or the database. Real logic lives here (the route is a
 * thin shell) to keep it inside the coverage-measured lib.
 */
export function buildHealthStatus(): { status: "ok"; service: string } {
  return { status: "ok", service: "spoonjoy" };
}
