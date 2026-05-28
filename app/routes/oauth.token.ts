import type { Route } from "./+types/oauth.token";
import { getRequestDb } from "~/lib/route-platform.server";
import { handleOAuthToken } from "~/lib/oauth-routes.server";

// RFC 6749 token endpoint (authorization_code + PKCE) — thin shell.
export async function action({ request, context }: Route.ActionArgs) {
  const db = await getRequestDb(context);
  return handleOAuthToken(request, db, context.cloudflare?.env);
}
