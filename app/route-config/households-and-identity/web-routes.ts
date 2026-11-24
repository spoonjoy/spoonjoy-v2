// How the Apple apps and link previews treat each route in ./routes.ts. WEB_ROUTE_MANIFEST
// (app/lib/web-route-manifest.server.ts) spreads these in.
import { webRoute, type WebRouteClassification } from "../web-route";

export default [
  // Households are web-only for now: the iPhone app has no household screens to open a link in.
  webRoute("routes/households._index.tsx", "/households", "user-product", { universalLink: false }),
  webRoute("routes/households.$id.tsx", "/households/:id", "user-product", { universalLink: false }),
  webRoute("routes/households.$id.lists._index.tsx", "/households/:id/lists", "user-product", { universalLink: false }),
  webRoute("routes/households.$id.plan.tsx", "/households/:id/plan", "user-product", { universalLink: false }),
  webRoute("routes/households.$id.lists.$listId.tsx", "/households/:id/lists/:listId", "user-product", { universalLink: false }),
  webRoute("routes/auth.oidc.tsx", "/auth/oidc", "secure-web-handoff"),
  webRoute("routes/auth.oidc.callback.tsx", "/auth/oidc/callback", "secure-web-handoff"),
  // A self-hosted server's settings, for its admin; spoonjoy.app has no such page.
  webRoute("routes/account.server-settings.tsx", "/account/server", "intentional-exclude"),
  webRoute("routes/account.server-backups.$name.tsx", "/account/server/backups/:name", "intentional-exclude"),
] as const satisfies readonly WebRouteClassification[];
