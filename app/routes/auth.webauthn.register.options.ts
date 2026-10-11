import type { Route } from "./+types/auth.webauthn.register.options";
import { getUserId } from "~/lib/session.server";
import { getRequestDb } from "~/lib/route-platform.server";
import { configFromRequest, startRegistration, webAuthnErrorResponse } from "~/lib/webauthn-route.server";
import { authTelemetryFromContext } from "~/lib/auth-telemetry.server";

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare?.env;
  const userId = await getUserId(request, env);
  if (!userId) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const db = await getRequestDb(context);
    const options = await startRegistration(
      db,
      userId,
      configFromRequest(request),
      authTelemetryFromContext(context),
    );
    return Response.json(options);
  } catch (error) {
    return webAuthnErrorResponse(error, "Could not start registration");
  }
}
