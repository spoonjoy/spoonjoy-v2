import type { Route } from "./+types/well-known.apple-app-site-association";
import { buildAppleAppSiteAssociation } from "~/lib/web-route-manifest.server";

export function loader({ context }: Route.LoaderArgs) {
  return Response.json(buildAppleAppSiteAssociation(context.cloudflare?.env), {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  });
}
