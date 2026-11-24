// This context's pages and endpoints. app/routes.ts spreads them in, so pull requests that add
// routes to different contexts never edit the same lines. Classify each one in ./web-routes.ts too.
import { type RouteConfig, route } from "@react-router/dev/routes";

export default [
  // Bring a kitchen in from another app's backup.
  route("move-in", "routes/move-in.tsx"),
  // The page's upload of a backup in parts, straight to storage: begin, each part, then finish (or stop).
  route("move-in/uploads", "routes/move-in.uploads.ts"),
  route("move-in/uploads/:uploadId", "routes/move-in.uploads.$uploadId.ts"),
  route("move-in/uploads/:uploadId/parts/:partNumber", "routes/move-in.uploads.$uploadId.parts.$partNumber.ts"),
] satisfies RouteConfig;
