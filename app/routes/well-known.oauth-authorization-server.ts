import type { Route } from "./+types/well-known.oauth-authorization-server";
import { buildAuthorizationServerMetadata, resolveIssuerOrigin } from "~/lib/oauth-metadata.server";

// RFC 8414 Authorization Server Metadata — thin shell over the measured builder.
export function loader({ request, context }: Route.LoaderArgs) {
  const origin = resolveIssuerOrigin(request.url, context.cloudflare?.env?.SPOONJOY_BASE_URL);
  return Response.json(buildAuthorizationServerMetadata(origin));
}
