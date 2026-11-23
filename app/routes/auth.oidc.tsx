import type { Route } from "./+types/auth.oidc";
import { redirect } from "react-router";
import { generateCodeVerifier } from "arctic";
import { getOidcConfig } from "~/lib/env.server";
import {
  appendOAuthError,
  assertCanStartOAuthLinking,
  buildOAuthCallbackUrl,
  commitOAuthStartSession,
  generateOAuthState,
  getOAuthEnv,
  redirectTo,
  resolveOAuthStartSessionData,
} from "~/lib/oauth-route.server";
import { createOidcAuthorizationURL, generateOidcNonce } from "~/lib/oidc.server";
import { authTelemetryFromContext } from "~/lib/auth-telemetry.server";

// Sign-in with the server owner's own OpenID Connect provider (SPOONJOY_OIDC_*, oidc.server.ts).
async function initiateOidcOAuth({ request, context }: Route.LoaderArgs | Route.ActionArgs) {
  const state = generateOAuthState();
  const codeVerifier = generateCodeVerifier();
  const nonce = generateOidcNonce();
  const sessionData = resolveOAuthStartSessionData(request, state, { codeVerifier, nonce });
  const env = context.cloudflare?.env;
  const linkingRedirect = await assertCanStartOAuthLinking(request, sessionData, env);
  if (linkingRedirect) return linkingRedirect;

  const telemetry = authTelemetryFromContext(context);
  let config;
  let redirectUri;
  try {
    config = getOidcConfig(getOAuthEnv(context));
    redirectUri = buildOAuthCallbackUrl(request, "oidc", env?.SPOONJOY_BASE_URL);
  } catch (error) {
    telemetry.captureException(error, { provider: "oidc", phase: "initiate" });
    return redirect(appendOAuthError(sessionData.failureRedirect, "oauth_unconfigured"));
  }

  let authorizationUrl;
  try {
    authorizationUrl = await createOidcAuthorizationURL(config, redirectUri, state, codeVerifier, nonce);
  } catch (error) {
    // Discovery failed: the provider is down or its discovery document is unusable.
    telemetry.captureException(error, { provider: "oidc", phase: "discovery" });
    return redirect(appendOAuthError(sessionData.failureRedirect, "provider_unavailable"));
  }
  sessionData.redirectUri = redirectUri;
  const cookie = await commitOAuthStartSession(request, "oidc", sessionData, env);

  return redirectTo(authorizationUrl.toString(), { "Set-Cookie": cookie });
}

export async function loader(args: Route.LoaderArgs) {
  return initiateOidcOAuth(args);
}

export async function action(args: Route.ActionArgs) {
  return initiateOidcOAuth(args);
}

export default function OidcOAuthRoute() {
  return null;
}
