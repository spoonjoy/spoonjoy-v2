import type { Route } from "./+types/well-known.oauth-authorization-server";
import { buildAuthorizationServerMetadata } from "~/lib/oauth-metadata.server";

// RFC 8414 Authorization Server Metadata — thin shell over the measured builder.
export function loader({ request }: Route.LoaderArgs) {
  const origin = new URL(request.url).origin;
  return Response.json(buildAuthorizationServerMetadata(origin));
}
