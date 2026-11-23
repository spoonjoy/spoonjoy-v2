// This context's pages and endpoints. app/routes.ts spreads them in, so pull requests that add
// routes to different contexts never edit the same lines. Classify each one in ./web-routes.ts too.
import { type RouteConfig, route } from "@react-router/dev/routes";

export default [
  route("households", "routes/households._index.tsx"),
  route("households/:id", "routes/households.$id.tsx"),
] satisfies RouteConfig;
