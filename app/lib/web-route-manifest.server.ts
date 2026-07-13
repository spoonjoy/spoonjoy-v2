export const APPLE_BUNDLE_IDS = [
  "app.spoonjoy",
  "app.spoonjoy.mac",
  "app.spoonjoy.Spoonjoy",
  "app.spoonjoy.Spoonjoy.mac",
] as const;
export const APPLE_TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/;

export type WebRouteCategory =
  | "user-product"
  | "secure-web-handoff"
  | "api-or-oauth"
  | "developer-resource"
  | "platform-asset"
  | "intentional-exclude";

export type WebRouteClassification = {
  routeId: string;
  routeFile: string;
  urlPattern: `/${string}`;
  category: WebRouteCategory;
  universalLink: boolean;
  publicShareable: boolean;
};

export type AppleAppLinkComponent = {
  "/": string;
  "?"?: { "*": "*" };
};

function route(
  routeFile: string,
  urlPattern: `/${string}`,
  category: WebRouteCategory,
  options: { universalLink?: boolean; publicShareable?: boolean } = {},
): WebRouteClassification {
  return {
    routeId: routeFile.replace(/^routes\//, "").replace(/\.(tsx|ts)$/, ""),
    routeFile,
    urlPattern,
    category,
    universalLink: options.universalLink ?? category === "user-product",
    publicShareable: options.publicShareable ?? false,
  };
}

export const WEB_ROUTE_MANIFEST = [
  route("routes/_index.tsx", "/", "user-product", { universalLink: true }),
  route("routes/login.tsx", "/login", "secure-web-handoff"),
  route("routes/signup.tsx", "/signup", "secure-web-handoff"),
  route("routes/logout.tsx", "/logout", "secure-web-handoff"),
  route("routes/auth.google.tsx", "/auth/google", "secure-web-handoff"),
  route("routes/auth.google.callback.tsx", "/auth/google/callback", "secure-web-handoff"),
  route("routes/auth.github.tsx", "/auth/github", "secure-web-handoff"),
  route("routes/auth.github.callback.tsx", "/auth/github/callback", "secure-web-handoff"),
  route("routes/auth.apple.tsx", "/auth/apple", "secure-web-handoff"),
  route("routes/auth.apple.callback.tsx", "/auth/apple/callback", "secure-web-handoff"),
  route("routes/auth.webauthn.register.options.ts", "/auth/webauthn/register/options", "secure-web-handoff"),
  route("routes/auth.webauthn.register.verify.ts", "/auth/webauthn/register/verify", "secure-web-handoff"),
  route("routes/auth.webauthn.authenticate.options.ts", "/auth/webauthn/authenticate/options", "secure-web-handoff"),
  route("routes/auth.webauthn.authenticate.verify.ts", "/auth/webauthn/authenticate/verify", "secure-web-handoff"),
  route("routes/agent.connect.tsx", "/agent/connect", "secure-web-handoff"),
  route("routes/agent.connect.$requestId.tsx", "/agent/connect/:requestId", "secure-web-handoff"),
  route("routes/redwood-functions-auth-oauth.tsx", "/.redwood/functions/auth/oauth", "api-or-oauth"),
  route("routes/privacy.tsx", "/privacy", "platform-asset"),
  route("routes/terms.tsx", "/terms", "platform-asset"),
  route("routes/search.tsx", "/search", "user-product", { universalLink: true }),
  route("routes/my-recipes.tsx", "/my-recipes", "user-product", { universalLink: true }),
  route("routes/saved-recipes.tsx", "/saved-recipes", "user-product", { universalLink: true }),
  route("routes/chefs.tsx", "/chefs", "user-product", { universalLink: true }),
  route("routes/sitemap.xml.tsx", "/sitemap.xml", "platform-asset"),
  route("routes/robots.txt.tsx", "/robots.txt", "platform-asset"),
  route("routes/og.pages.$slug.png.tsx", "/og/pages/:slug.png", "platform-asset"),
  route("routes/og.recipes.$id.png.tsx", "/og/recipes/:id.png", "platform-asset"),
  route("routes/og.cookbooks.$id.png.tsx", "/og/cookbooks/:id.png", "platform-asset"),
  route("routes/recipes.tsx", "/recipes", "user-product", { universalLink: true }),
  route("routes/recipes._index.tsx", "/recipes", "user-product", { universalLink: true }),
  route("routes/recipes.new.tsx", "/recipes/new", "user-product", { universalLink: true }),
  route("routes/recipes.$id.tsx", "/recipes/:id", "user-product", { universalLink: true, publicShareable: true }),
  route("routes/recipes.$id.edit.tsx", "/recipes/:id/edit", "user-product", { universalLink: true }),
  route("routes/recipes.$id.fork.tsx", "/recipes/:id/fork", "user-product", { universalLink: true }),
  route("routes/recipes.$id.steps.new.tsx", "/recipes/:id/steps/new", "user-product", { universalLink: true }),
  route("routes/recipes.$id.steps.$stepId.edit.tsx", "/recipes/:id/steps/:stepId/edit", "user-product", { universalLink: true }),
  route("routes/cookbooks.tsx", "/cookbooks", "user-product", { universalLink: true }),
  route("routes/cookbooks._index.tsx", "/cookbooks", "user-product", { universalLink: true }),
  route("routes/cookbooks.new.tsx", "/cookbooks/new", "user-product", { universalLink: true }),
  route("routes/cookbooks.$id.tsx", "/cookbooks/:id", "user-product", { universalLink: true, publicShareable: true }),
  route("routes/shopping-list.tsx", "/shopping-list", "user-product", { universalLink: true }),
  route("routes/account.settings.tsx", "/account/settings", "user-product", { universalLink: true }),
  route("routes/developers.tsx", "/developers", "developer-resource"),
  route("routes/developers.playground.tsx", "/developers/playground", "developer-resource"),
  route("routes/api.tsx", "/api", "developer-resource"),
  route("routes/api.docs.ts", "/api/docs", "developer-resource"),
  route("routes/api.docs.$.ts", "/api/docs/*", "developer-resource"),
  route("routes/api.developer.ts", "/api/developer", "developer-resource"),
  route("routes/api.developer.$.ts", "/api/developer/*", "developer-resource"),
  route("routes/api.developers.ts", "/api/developers", "developer-resource"),
  route("routes/api.developers.$.ts", "/api/developers/*", "developer-resource"),
  route("routes/api.playground.ts", "/api/playground", "developer-resource"),
  route("routes/api.try.ts", "/api/try", "developer-resource"),
  route("routes/api.openapi.ts", "/api/openapi", "developer-resource"),
  route("routes/api.openapi-json.ts", "/api/openapi.json", "developer-resource"),
  route("routes/api.openapi-spec.ts", "/api/spec", "developer-resource"),
  route("routes/users.$identifier.tsx", "/users/:identifier", "user-product", { universalLink: true }),
  route("routes/users.$identifier.fellow-chefs.tsx", "/users/:identifier/fellow-chefs", "user-product", { universalLink: true }),
  route("routes/users.$identifier.kitchen-visitors.tsx", "/users/:identifier/kitchen-visitors", "user-product", { universalLink: true }),
  route("routes/api.push.public-key.ts", "/api/push/public-key", "api-or-oauth"),
  route("routes/api.push.subscriptions.ts", "/api/push/subscriptions", "api-or-oauth"),
  route("routes/api.push.preferences.ts", "/api/push/preferences", "api-or-oauth"),
  route("routes/api.v1.$.ts", "/api/v1/*", "api-or-oauth"),
  route("routes/api.$.ts", "/api/*", "api-or-oauth"),
  route("routes/mcp.ts", "/mcp", "api-or-oauth"),
  route("routes/csp-report.ts", "/csp-report", "api-or-oauth"),
  route("routes/health.ts", "/health", "platform-asset"),
  route("routes/oauth.register.ts", "/oauth/register", "api-or-oauth"),
  route("routes/oauth.authorize.tsx", "/oauth/authorize", "secure-web-handoff"),
  route("routes/oauth.callback.tsx", "/oauth/callback", "secure-web-handoff", { universalLink: true }),
  route("routes/oauth.token.ts", "/oauth/token", "api-or-oauth"),
  route("routes/oauth.revoke.ts", "/oauth/revoke", "api-or-oauth"),
  route("routes/well-known.oauth-authorization-server.ts", "/.well-known/oauth-authorization-server", "api-or-oauth"),
  route("routes/well-known.oauth-protected-resource.ts", "/.well-known/oauth-protected-resource", "api-or-oauth"),
  route("routes/well-known.oauth-protected-resource.mcp.ts", "/.well-known/oauth-protected-resource/mcp", "api-or-oauth"),
  route("routes/well-known.apple-app-site-association.ts", "/.well-known/apple-app-site-association", "platform-asset"),
  route("routes/photos.$.tsx", "/photos/*", "platform-asset"),
  route("routes/devtools-well-known.tsx", "/.well-known/appspecific/com.chrome.devtools.json", "platform-asset"),
  route("routes/$.tsx", "/*", "intentional-exclude", { universalLink: false }),
] as const satisfies readonly WebRouteClassification[];

export const APPLE_APP_LINK_COMPONENTS = [
  { "/": "/" },
  { "/": "/recipes" },
  { "/": "/recipes/*" },
  { "/": "/cookbooks" },
  { "/": "/cookbooks/*" },
  { "/": "/users/*" },
  { "/": "/my-recipes" },
  { "/": "/saved-recipes" },
  { "/": "/chefs" },
  { "/": "/shopping-list" },
  { "/": "/search" },
  { "/": "/search", "?": { "*": "*" } },
  { "/": "/recipes/new" },
  { "/": "/account/settings" },
  { "/": "/oauth/callback" },
  { "/": "/oauth/callback", "?": { "*": "*" } },
] as const satisfies readonly AppleAppLinkComponent[];

export function appleTeamID(env: Pick<Env, "APPLE_TEAM_ID"> | null | undefined) {
  const configured = env?.APPLE_TEAM_ID?.trim().toUpperCase();
  if (!configured) {
    throw new Error("APPLE_TEAM_ID is required to serve Apple App Site Association metadata.");
  }
  if (!APPLE_TEAM_ID_PATTERN.test(configured)) {
    throw new Error("APPLE_TEAM_ID must be a 10-character alphanumeric Apple Developer Team ID.");
  }
  return configured;
}

export function buildAppleAppSiteAssociation(env?: Pick<Env, "APPLE_TEAM_ID"> | null) {
  const appIDs = APPLE_BUNDLE_IDS.map((bundleID) => `${appleTeamID(env)}.${bundleID}`);
  return {
    applinks: {
      apps: [],
      details: [
        {
          appIDs,
          components: APPLE_APP_LINK_COMPONENTS,
        },
      ],
    },
  };
}
