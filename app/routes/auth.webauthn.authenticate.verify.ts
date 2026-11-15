import type { Route } from "./+types/auth.webauthn.authenticate.verify";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { createUserSessionCookie, sanitizeSessionRedirect } from "~/lib/session.server";
import { claimPendingAppleLinkFromCookie } from "~/lib/pending-apple-link.server";
import { getRequestDb } from "~/lib/route-platform.server";
import { configFromRequest, finishAuthentication, webAuthnErrorResponse } from "~/lib/webauthn-route.server";
import { authTelemetryFromContext } from "~/lib/auth-telemetry.server";
import { requestD1 } from "~/lib/d1-read.server";
import { enforceAuthRateLimit, rateLimitedResponse } from "~/lib/rate-limit.server";
import { extractIdentifierFromBody, lookupUserIdByEmailOrUsername, resolveIdentifierToEmail } from "~/lib/auth.server";
import { recordSignInFailed, recordSignInSucceeded } from "~/lib/sign-in-outcome.server";
import { recordAccountSignIn } from "~/lib/account-activity.server";
import { isD1Unavailable } from "~/lib/d1-write-retry.server";

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare?.env;
  const telemetry = authTelemetryFromContext(context);
  const capture = telemetry.captureEvent.bind(telemetry);

  const rateLimit = await enforceAuthRateLimit(request, env?.AUTH_IP_RATE_LIMITER);
  if (!rateLimit.allowed) {
    recordSignInFailed(capture, { method: "passkey", platform: "web", failureReason: "rate_limited" });
    return rateLimitedResponse(rateLimit.retryAfterSeconds);
  }

  let body: { identifier?: string; email?: string; response?: AuthenticationResponseJSON; redirectTo?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    recordSignInFailed(capture, { method: "passkey", platform: "web", failureReason: "invalid_request" });
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const identifier = extractIdentifierFromBody(body);
  if (!identifier || !body.response) {
    recordSignInFailed(capture, { method: "passkey", platform: "web", failureReason: "missing_fields" });
    return Response.json({ error: "Username or email and authentication response are required" }, { status: 400 });
  }

  let db: Awaited<ReturnType<typeof getRequestDb>> | undefined;
  try {
    const requestDb = await getRequestDb(context);
    db = requestDb;
    // Same identifier resolution as the options route, so a chef who typed
    // a username there can complete verification with that same username.
    const email = await resolveIdentifierToEmail(requestDb, identifier);
    const result = await finishAuthentication(
      requestDb,
      email,
      configFromRequest(request),
      body.response,
      telemetry,
      // The counter rotation and challenge clear run as one D1 batch when there is a binding.
      requestD1(context),
    );

    // Mint the session cookie and attach it to the JSON response (the client
    // navigates itself after a verified passkey login). Built with `new
    // Response` rather than `Response.json` so the `Set-Cookie` header is
    // preserved across runtimes.
    const redirectTo = sanitizeSessionRedirect(
      typeof body.redirectTo === "string" ? body.redirectTo : "/",
    );
    const cookie = await createUserSessionCookie(result.userId, env, request, {
      sessionVersion: result.sessionVersion,
      signInMethod: "passkey",
    });
    const headers = new Headers({ "Content-Type": "application/json" });
    headers.append("Set-Cookie", cookie);
    // An Apple sign-in in this browser that found no account left a pending link: connect it now.
    const clearedPendingAppleLink = await claimPendingAppleLinkFromCookie(async () => requestDb, request, env, result.userId);
    if (clearedPendingAppleLink) headers.append("Set-Cookie", clearedPendingAppleLink);
    recordSignInSucceeded(capture, { method: "passkey", platform: "web", userId: result.userId });
    await recordAccountSignIn(env, result.userId, "passkey");
    return new Response(JSON.stringify({ verified: true, redirectTo }), { status: 200, headers });
  } catch (error) {
    const databaseUnavailable = isD1Unavailable(error);
    recordSignInFailed(capture, {
      method: "passkey",
      platform: "web",
      failureReason: databaseUnavailable ? "database_unavailable" : "verification_failed",
      matchedUserId: telemetry.enabled && db && !databaseUnavailable ? await lookupUserIdByEmailOrUsername(db, identifier) : null,
    });
    return webAuthnErrorResponse(error, "Passkey sign-in didn't finish: the server hit an unexpected fault");
  }
}
