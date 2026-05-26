import type { Route } from "./+types/auth.google.callback";
import { handleGoogleCallback } from "~/lib/oauth-callback-route.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  return handleGoogleCallback(request, context);
}

export default function GoogleOAuthCallbackRoute() {
  return null;
}
