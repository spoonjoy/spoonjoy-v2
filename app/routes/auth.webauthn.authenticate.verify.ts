import type { Route } from "./+types/auth.webauthn.authenticate.verify";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { createUserSessionCookie, sanitizeSessionRedirect } from "~/lib/session.server";
import { getRequestDb } from "~/lib/route-platform.server";
import { configFromRequest, finishAuthentication, WebAuthnError } from "~/lib/webauthn-route.server";
import { enforceAuthRateLimit, rateLimitedResponse } from "~/lib/rate-limit.server";

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare?.env;

  const rateLimit = await enforceAuthRateLimit(request, env?.AUTH_IP_RATE_LIMITER);
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit.retryAfterSeconds);
  }

  let body: { email?: string; response?: AuthenticationResponseJSON; redirectTo?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !body.response) {
    return Response.json({ error: "Email and authentication response are required" }, { status: 400 });
  }

  try {
    const db = await getRequestDb(context);
    const result = await finishAuthentication(db, email, configFromRequest(request), body.response);

    // Mint the session cookie and attach it to the JSON response (the client
    // navigates itself after a verified passkey login). Built with `new
    // Response` rather than `Response.json` so the `Set-Cookie` header is
    // preserved across runtimes.
    const redirectTo = sanitizeSessionRedirect(
      typeof body.redirectTo === "string" ? body.redirectTo : "/",
    );
    const cookie = await createUserSessionCookie(result.userId, env);
    return new Response(JSON.stringify({ verified: true, redirectTo }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": cookie,
      },
    });
  } catch (error) {
    const status = error instanceof WebAuthnError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Could not verify authentication";
    return Response.json({ error: message }, { status });
  }
}
