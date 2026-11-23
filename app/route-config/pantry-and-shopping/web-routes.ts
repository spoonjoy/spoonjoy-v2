// How the Apple apps and link previews treat each route in ./routes.ts. WEB_ROUTE_MANIFEST
// (app/lib/web-route-manifest.server.ts) spreads these in.
import type { WebRouteClassification } from "../web-route";

export default [] as const satisfies readonly WebRouteClassification[];
