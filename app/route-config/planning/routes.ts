// This context's pages and endpoints. app/routes.ts spreads them in, so pull requests that add
// routes to different contexts never edit the same lines. Classify each one in ./web-routes.ts too.
import { type RouteConfig, route } from "@react-router/dev/routes";

export default [
  route("plan", "routes/plan.tsx"),
  // The meal plan's private calendar feed, at /calendar/<token>.ics
  route("calendar/:feed", "routes/calendar.$feed.ts"),
] satisfies RouteConfig;
