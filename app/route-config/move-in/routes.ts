// This context's pages and endpoints. app/routes.ts spreads them in, so pull requests that add
// routes to different contexts never edit the same lines. Classify each one in ./web-routes.ts too.
import { type RouteConfig, route } from "@react-router/dev/routes";

export default [
  // Bring a kitchen in from another app's backup.
  route("move-in", "routes/move-in.tsx"),
] satisfies RouteConfig;
