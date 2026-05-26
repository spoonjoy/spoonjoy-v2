import type { AppLoadContext } from "react-router";
import {
  handleAppleCallback,
  handleGitHubCallback,
  handleGoogleCallback,
} from "~/lib/oauth-callback-route.server";
import { redirectTo } from "~/lib/oauth-route.server";

const APPLE_METHODS = new Set(["loginWithApple", "signupWithApple", "linkAppleAccount"]);
const GITHUB_METHODS = new Set(["loginWithGitHub", "signupWithGitHub", "linkGitHubAccount"]);
const GOOGLE_METHODS = new Set(["loginWithGoogle", "signupWithGoogle", "linkGoogleAccount"]);

function legacyMethod(request: Request): string | null {
  return new URL(request.url).searchParams.get("method");
}

interface LegacyOAuthRouteArgs {
  request: Request;
  context: AppLoadContext;
}

export async function action({ request, context }: LegacyOAuthRouteArgs) {
  const method = legacyMethod(request);

  if (method && APPLE_METHODS.has(method)) {
    return handleAppleCallback(request, context);
  }

  return redirectTo("/login?oauthError=invalid_request");
}

export async function loader({ request, context }: LegacyOAuthRouteArgs) {
  const method = legacyMethod(request);

  if (method && GITHUB_METHODS.has(method)) {
    return handleGitHubCallback(request, context);
  }

  if (method && GOOGLE_METHODS.has(method)) {
    return handleGoogleCallback(request, context);
  }

  return redirectTo("/login?oauthError=invalid_request");
}

export default function LegacyDbAuthOAuthRoute() {
  return null;
}
