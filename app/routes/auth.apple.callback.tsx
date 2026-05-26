import type { Route } from "./+types/auth.apple.callback";
import { handleAppleCallback } from "~/lib/oauth-callback-route.server";
import { readOAuthStartSession, redirectWithOAuthError } from "~/lib/oauth-route.server";

export async function action({ request, context }: Route.ActionArgs) {
  return handleAppleCallback(request, context);
}

export async function loader({ request }: Route.LoaderArgs) {
  const stored = await readOAuthStartSession(request, "apple");
  return redirectWithOAuthError(request, "apple", stored?.failureRedirect ?? "/login", "invalid_request");
}

export default function AppleOAuthCallbackRoute() {
  return null;
}
