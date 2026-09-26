import type { Route } from "./+types/auth.webauthn.authenticate.options";
import { getRequestDb } from "~/lib/route-platform.server";
import { configFromRequest, startAuthentication } from "~/lib/webauthn-route.server";
import { authTelemetryFromContext } from "~/lib/auth-telemetry.server";
import { enforceAuthRateLimit, rateLimitedResponse } from "~/lib/rate-limit.server";
import { extractIdentifierFromBody, resolveIdentifierToEmail } from "~/lib/auth.server";

export async function action({ request, context }: Route.ActionArgs) {
  const rateLimit = await enforceAuthRateLimit(request, context.cloudflare?.env?.AUTH_IP_RATE_LIMITER);
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit.retryAfterSeconds);
  }

  let body: { identifier?: string; email?: string };
  try {
    body = (await request.json()) as { identifier?: string; email?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const identifier = extractIdentifierFromBody(body);
  if (!identifier) {
    return Response.json({ error: "Username or email is required" }, { status: 400 });
  }

  try {
    const db = await getRequestDb(context);

    // startAuthentication itself only looks up by email, so a username is
    // resolved to its account's email first (same lookup shape as
    // authenticateUserByEmailOrUsername); an unknown username resolves to
    // nothing and falls through to startAuthentication's existing "unknown
    // user" behavior (empty allow list, no error) unchanged.
    const email = await resolveIdentifierToEmail(db, identifier);

    const options = await startAuthentication(
      db,
      email,
      configFromRequest(request),
      authTelemetryFromContext(context),
    );
    return Response.json(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start authentication";
    return Response.json({ error: message }, { status: 400 });
  }
}
