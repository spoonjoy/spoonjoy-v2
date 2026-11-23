// How the Apple apps and link previews treat each route in ./routes.ts. WEB_ROUTE_MANIFEST
// (app/lib/web-route-manifest.server.ts) spreads these in.
import { webRoute, type WebRouteClassification } from "../web-route";

export default [
  // The meal plan stays in the browser until the Apple app has a planner to open it in.
  webRoute("routes/plan.tsx", "/plan", "user-product", { universalLink: false }),
] as const satisfies readonly WebRouteClassification[];
