// How the Apple apps and link previews treat each route in ./routes.ts. WEB_ROUTE_MANIFEST
// (app/lib/web-route-manifest.server.ts) spreads these in.
import { webRoute, type WebRouteClassification } from "../web-route";

export default [
  // The meal plan stays in the browser until the Apple app has a planner to open it in.
  webRoute("routes/plan.tsx", "/plan", "user-product", { universalLink: false }),
  // A calendar app fetches the feed; it is never a page to open in the Apple apps or to share.
  webRoute("routes/calendar.$feed.ts", "/calendar/:feed", "api-or-oauth"),
] as const satisfies readonly WebRouteClassification[];
