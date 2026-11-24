// This context's pages and endpoints. app/routes.ts spreads them in, so pull requests that add
// routes to different contexts never edit the same lines. Classify each one in ./web-routes.ts too.
import { type RouteConfig, route } from "@react-router/dev/routes";

export default [
  route("households", "routes/households._index.tsx"),
  route("households/:id", "routes/households.$id.tsx"),
  // A household's shared shopping lists (app/domains/pantry-and-shopping).
  route("households/:id/lists", "routes/households.$id.lists._index.tsx"),
  route("households/:id/lists/:listId", "routes/households.$id.lists.$listId.tsx"),
  // Sign-in with a self-hosted server's own OpenID Connect provider.
  route("auth/oidc", "routes/auth.oidc.tsx"),
  route("auth/oidc/callback", "routes/auth.oidc.callback.tsx"),
  // A self-hosted server's admin settings: who may sign up, invite links, and backups to download.
  route("account/server", "routes/account.server-settings.tsx"),
  route("account/server/backups/:name", "routes/account.server-backups.$name.tsx"),
] satisfies RouteConfig;
