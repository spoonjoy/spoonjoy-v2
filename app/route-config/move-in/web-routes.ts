// How the Apple apps and link previews treat each route in ./routes.ts. WEB_ROUTE_MANIFEST
// (app/lib/web-route-manifest.server.ts) spreads these in.
import { webRoute, type WebRouteClassification } from "../web-route";

export default [
  // Web only until the iPhone app has a Move in screen: a universal link would open the app on nothing.
  webRoute("routes/move-in.tsx", "/move-in", "user-product", { universalLink: false }),
  // The page's upload endpoints: JSON and bytes for its script, never a page to open.
  webRoute("routes/move-in.uploads.ts", "/move-in/uploads", "api-or-oauth"),
  webRoute("routes/move-in.uploads.$uploadId.ts", "/move-in/uploads/:uploadId", "api-or-oauth"),
  webRoute("routes/move-in.uploads.$uploadId.parts.$partNumber.ts", "/move-in/uploads/:uploadId/parts/:partNumber", "api-or-oauth"),
] as const satisfies readonly WebRouteClassification[];
