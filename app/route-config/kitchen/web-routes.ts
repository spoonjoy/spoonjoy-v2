// How the Apple apps and link previews treat each route in ./routes.ts. WEB_ROUTE_MANIFEST
// (app/lib/web-route-manifest.server.ts) spreads these in.
import { webRoute, type WebRouteClassification } from "../web-route";

export default [
  // Organizer pages are web-only until the apps have them.
  webRoute("routes/tags._index.tsx", "/tags", "user-product", { universalLink: false }),
  webRoute("routes/tags.$slug.tsx", "/tags/:slug", "user-product", { universalLink: false }),
  webRoute("routes/categories._index.tsx", "/categories", "user-product", { universalLink: false }),
  webRoute("routes/categories.$slug.tsx", "/categories/:slug", "user-product", { universalLink: false }),
  webRoute("routes/tools._index.tsx", "/tools", "user-product", { universalLink: false }),
  webRoute("routes/tools.$slug.tsx", "/tools/:slug", "user-product", { universalLink: false }),
  webRoute("routes/recipes.$id.organize.tsx", "/recipes/:id/organize", "user-product", { universalLink: false }),
  // Smart cookbooks are web-only until the apps have them.
  webRoute("routes/cookbooks.smart.new.tsx", "/cookbooks/smart/new", "user-product", { universalLink: false }),
  webRoute("routes/cookbooks.smart.$id.tsx", "/cookbooks/smart/:id", "user-product", { universalLink: false }),
] as const satisfies readonly WebRouteClassification[];
