import type { Route } from "./+types/well-known.apple-app-site-association";

const FALLBACK_TEAM_ID = "TEAMID";
const BUNDLE_IDS = ["app.spoonjoy.Spoonjoy", "app.spoonjoy.Spoonjoy.mac"] as const;

const APP_LINK_COMPONENTS = [
  { "/": "/" },
  { "/": "/recipes" },
  { "/": "/recipes/*" },
  { "/": "/cookbooks" },
  { "/": "/cookbooks/*" },
  { "/": "/users/*" },
  { "/": "/shopping-list" },
  { "/": "/search", "?": { "*": "*" } },
  { "/": "/recipes/new" },
  { "/": "/account/settings" },
];

function appleTeamID(env: Pick<Env, "SPOONJOY_APPLE_TEAM_ID"> | null | undefined) {
  const configured = env?.SPOONJOY_APPLE_TEAM_ID?.trim().toUpperCase();
  if (configured && /^[A-Z0-9]{10}$/.test(configured)) return configured;
  return FALLBACK_TEAM_ID;
}

export function buildAppleAppSiteAssociation(env?: Pick<Env, "SPOONJOY_APPLE_TEAM_ID"> | null) {
  const appIDs = BUNDLE_IDS.map((bundleID) => `${appleTeamID(env)}.${bundleID}`);
  return {
    applinks: {
      apps: [],
      details: [
        {
          appIDs,
          components: APP_LINK_COMPONENTS,
        },
      ],
    },
  };
}

export function loader({ context }: Route.LoaderArgs) {
  return Response.json(buildAppleAppSiteAssociation(context.cloudflare?.env), {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  });
}
