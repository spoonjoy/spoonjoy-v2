import type { Route } from "./+types/oauth.register";
import { getRequestDb } from "~/lib/route-platform.server";
import { handleOAuthRegister } from "~/lib/oauth-routes.server";

// RFC 7591 Dynamic Client Registration — thin shell over the measured handler.
export async function action({ request, context }: Route.ActionArgs) {
  const db = await getRequestDb(context);
  return handleOAuthRegister(request, db);
}
