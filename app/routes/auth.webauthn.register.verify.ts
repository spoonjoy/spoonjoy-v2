import type { Route } from "./+types/auth.webauthn.register.verify";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { getUserId } from "~/lib/session.server";
import { getRequestDb } from "~/lib/route-platform.server";
import { configFromRequest, finishRegistration, WebAuthnError } from "~/lib/webauthn-route.server";

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare?.env;
  const userId = await getUserId(request, env);
  if (!userId) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: { response?: RegistrationResponseJSON };
  try {
    body = (await request.json()) as { response?: RegistrationResponseJSON };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.response) {
    return Response.json({ error: "Missing registration response" }, { status: 400 });
  }

  try {
    const db = await getRequestDb(context);
    const result = await finishRegistration(db, userId, configFromRequest(request), body.response);
    return Response.json(result);
  } catch (error) {
    const status = error instanceof WebAuthnError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Could not verify registration";
    return Response.json({ error: message }, { status });
  }
}
