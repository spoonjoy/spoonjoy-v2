import type { Route } from "./+types/well-known.oauth-protected-resource.mcp";
import { buildProtectedResourceMetadata, resolveIssuerOrigin } from "~/lib/oauth-metadata.server";

// RFC 9728 path-specific Protected Resource Metadata for the /mcp resource.
export function loader({ request, context }: Route.LoaderArgs) {
  const origin = resolveIssuerOrigin(request.url, context.cloudflare?.env?.SPOONJOY_BASE_URL);
  return Response.json(buildProtectedResourceMetadata(origin));
}
