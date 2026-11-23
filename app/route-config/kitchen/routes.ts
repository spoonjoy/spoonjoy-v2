// This context's pages and endpoints. app/routes.ts spreads them in, so pull requests that add
// routes to different contexts never edit the same lines. Classify each one in ./web-routes.ts too.
import { type RouteConfig, route } from "@react-router/dev/routes";

export default [
  // A cook's tags, categories and tools, each with a page of its recipes.
  route("tags", "routes/tags._index.tsx"),
  route("tags/:slug", "routes/tags.$slug.tsx"),
  route("categories", "routes/categories._index.tsx"),
  route("categories/:slug", "routes/categories.$slug.tsx"),
  route("tools", "routes/tools._index.tsx"),
  route("tools/:slug", "routes/tools.$slug.tsx"),
  // Set a recipe's tags, categories and tools. The /recipes layout is a bare Outlet, so this
  // top-level route renders the same as a child of it would.
  route("recipes/:id/organize", "routes/recipes.$id.organize.tsx"),
] satisfies RouteConfig;
