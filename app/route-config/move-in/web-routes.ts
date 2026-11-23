// How the Apple apps and link previews treat each route in ./routes.ts. WEB_ROUTE_MANIFEST
// (app/lib/web-route-manifest.server.ts) spreads these in.
import { webRoute, type WebRouteClassification } from "../web-route";

export default [
  // Web only until the iPhone app has a Move in screen: a universal link would open the app on nothing.
  webRoute("routes/move-in.tsx", "/move-in", "user-product", { universalLink: false }),
] as const satisfies readonly WebRouteClassification[];
