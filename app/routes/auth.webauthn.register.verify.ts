import type { Route } from "./+types/auth.webauthn.register.verify";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { getUserId } from "~/lib/session.server";
import { getRequestDb } from "~/lib/route-platform.server";
import { configFromRequest, finishRegistration, webAuthnErrorResponse } from "~/lib/webauthn-route.server";
import { authTelemetryFromContext } from "~/lib/auth-telemetry.server";

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare?.env;
  const userId = await getUserId(request, env);
  if (!userId) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: { response?: RegistrationResponseJSON; name?: string };
  try {
    body = (await request.json()) as { response?: RegistrationResponseJSON; name?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.response) {
    return Response.json({ error: "Missing registration response" }, { status: 400 });
  }

  try {
    const db = await getRequestDb(context);
    const result = await finishRegistration(
      db,
      userId,
      configFromRequest(request),
      body.response,
      body.name,
      authTelemetryFromContext(context),
    );
    return Response.json(result);
  } catch (error) {
    return webAuthnErrorResponse(error, "Could not verify registration");
  }
}
