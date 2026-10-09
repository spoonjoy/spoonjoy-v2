import type { Route } from "./+types/logout";
import { data, redirect } from "react-router";
import { destroyUserSession, getUserId } from "~/lib/session.server";

// Opening /logout never signs anyone out. A GET can come from any site (an image tag, a link, a
// prefetch), so signing out on GET let any page log a visitor out. A signed-in visitor goes to
// their kitchen, where the Log out button posts the sign-out; a signed-out one goes to the login
// page.
export async function loader({ request, context }: Route.LoaderArgs) {
  const userId = await getUserId(request, context.cloudflare?.env);
  throw redirect(userId ? "/" : "/login");
}

// Browsers send the Origin header on form posts. A post that names another origin (or the
// opaque "null" origin) is refused, so only Spoonjoy's own pages can sign a visitor out. The
// session cookie is SameSite=Lax, so a cross-site post would not carry it anyway; this check
// makes the rule explicit rather than relying on the cookie attribute alone.
function isCrossOriginPost(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (origin === null) return false;
  return origin === "null" || origin !== new URL(request.url).origin;
}

export async function action({ request, context }: Route.ActionArgs) {
  if (isCrossOriginPost(request)) {
    return data({ error: "Sign-out must come from Spoonjoy." }, { status: 403 });
  }
  return destroyUserSession(request, "/login", context.cloudflare?.env);
}

export default function Logout() {
  return null;
}
