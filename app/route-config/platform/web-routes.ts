// How the Apple apps and link previews treat each route in ./routes.ts. WEB_ROUTE_MANIFEST
// (app/lib/web-route-manifest.server.ts) spreads these in.
import { webRoute, type WebRouteClassification } from "../web-route";

export default [
  // A public web page with no counterpart in the apps, like the roadmap.
  webRoute("routes/self-host.tsx", "/self-host", "platform-asset"),
] as const satisfies readonly WebRouteClassification[];
