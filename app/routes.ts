import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("login", "routes/login.tsx"),
  route("signup", "routes/signup.tsx"),
  route("logout", "routes/logout.tsx"),
  route("auth/google", "routes/auth.google.tsx"),
  route("auth/google/callback", "routes/auth.google.callback.tsx"),
  route("auth/apple", "routes/auth.apple.tsx"),
  route("auth/apple/callback", "routes/auth.apple.callback.tsx"),
  route("recipes", "routes/recipes.tsx", [
    index("routes/recipes._index.tsx"),
    route("new", "routes/recipes.new.tsx"),
    route(":id", "routes/recipes.$id.tsx"),
    route(":id/edit", "routes/recipes.$id.edit.tsx"),
    route(":id/steps/new", "routes/recipes.$id.steps.new.tsx"),
    route(":id/steps/:stepId/edit", "routes/recipes.$id.steps.$stepId.edit.tsx"),
  ]),
  route("cookbooks", "routes/cookbooks.tsx", [
    index("routes/cookbooks._index.tsx"),
    route("new", "routes/cookbooks.new.tsx"),
    route(":id", "routes/cookbooks.$id.tsx"),
  ]),
  route("shopping-list", "routes/shopping-list.tsx"),
  route("account/settings", "routes/account.settings.tsx"),
  route("users/:identifier", "routes/users.$identifier.tsx"),
  route("photos/*", "routes/photos.$.tsx"),
  route(".well-known/appspecific/com.chrome.devtools.json", "routes/devtools-well-known.tsx"),
  route("*", "routes/$.tsx"),
] satisfies RouteConfig;
