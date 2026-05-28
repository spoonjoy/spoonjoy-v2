import type { Route } from "./+types/well-known.oauth-protected-resource";
import { buildProtectedResourceMetadata } from "~/lib/oauth-metadata.server";

// RFC 9728 Protected Resource Metadata — thin shell over the measured builder.
export function loader({ request }: Route.LoaderArgs) {
  const origin = new URL(request.url).origin;
  return Response.json(buildProtectedResourceMetadata(origin));
}
