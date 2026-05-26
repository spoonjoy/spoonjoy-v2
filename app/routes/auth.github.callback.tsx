import type { Route } from "./+types/auth.github.callback";
import { handleGitHubCallback } from "~/lib/oauth-callback-route.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  return handleGitHubCallback(request, context);
}

export default function GitHubOAuthCallbackRoute() {
  return null;
}
