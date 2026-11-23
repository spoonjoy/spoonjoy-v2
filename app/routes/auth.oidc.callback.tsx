import type { Route } from "./+types/auth.oidc.callback";
import { handleOidcCallback } from "~/lib/oauth-callback-route.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  return handleOidcCallback(request, context);
}

export default function OidcOAuthCallbackRoute() {
  return null;
}
