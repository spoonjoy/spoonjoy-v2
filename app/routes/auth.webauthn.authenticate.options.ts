import type { Route } from "./+types/auth.webauthn.authenticate.options";
import { getRequestDb } from "~/lib/route-platform.server";
import { configFromRequest, startAuthentication, WebAuthnError } from "~/lib/webauthn-route.server";

export async function action({ request, context }: Route.ActionArgs) {
  let body: { email?: string };
  try {
    body = (await request.json()) as { email?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) {
    return Response.json({ error: "Email is required" }, { status: 400 });
  }

  try {
    const db = await getRequestDb(context);
    const options = await startAuthentication(db, email, configFromRequest(request));
    return Response.json(options);
  } catch (error) {
    const status = error instanceof WebAuthnError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Could not start authentication";
    return Response.json({ error: message }, { status });
  }
}
