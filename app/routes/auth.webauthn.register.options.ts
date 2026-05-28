import type { Route } from "./+types/auth.webauthn.register.options";
import { getUserId } from "~/lib/session.server";
import { getRequestDb } from "~/lib/route-platform.server";
import { configFromRequest, startRegistration, WebAuthnError } from "~/lib/webauthn-route.server";

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare?.env;
  const userId = await getUserId(request, env);
  if (!userId) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const db = await getRequestDb(context);
    const options = await startRegistration(db, userId, configFromRequest(request));
    return Response.json(options);
  } catch (error) {
    const status = error instanceof WebAuthnError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Could not start registration";
    return Response.json({ error: message }, { status });
  }
}
