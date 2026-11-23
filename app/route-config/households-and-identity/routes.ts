// This context's pages and endpoints. app/routes.ts spreads them in, so pull requests that add
// routes to different contexts never edit the same lines. Classify each one in ./web-routes.ts too.
import { type RouteConfig, route } from "@react-router/dev/routes";

export default [
  route("households", "routes/households._index.tsx"),
  route("households/:id", "routes/households.$id.tsx"),
  // Sign-in with a self-hosted server's own OpenID Connect provider.
  route("auth/oidc", "routes/auth.oidc.tsx"),
  route("auth/oidc/callback", "routes/auth.oidc.callback.tsx"),
  // A self-hosted server's admin settings: who may sign up, and invite links.
  route("account/server", "routes/account.server-settings.tsx"),
] satisfies RouteConfig;
